<?php
namespace App\Services\Finance;
use Carbon\CarbonImmutable;
use Symfony\Component\Process\Process;

class CreditPdfImporter
{
    private function process(array $args,float $timeout): string
    {
        $process=new Process($args);$process->setTimeout($timeout);
        $read=0;
        try{$process->run(function($type,$buffer)use(&$read,$process){$read+=strlen($buffer);if($read>2*1024*1024){$process->stop(0);abort(422,'В PDF слишком много текста. Загрузите только страницы графика.');}});}catch(\Symfony\Component\Process\Exception\ProcessTimedOutException){abort(422,'Распознавание заняло слишком много времени. Загрузите PDF меньшего размера.');}
        abort_unless($process->isSuccessful(),422,'Не удалось прочитать PDF. Проверьте, что файл открывается без пароля и не повреждён.');
        return $process->getOutput();
    }
    public function import(string $bytes): array
    {
        abort_unless(str_starts_with($bytes,'%PDF-'),422,'Выберите настоящий PDF-файл с графиком платежей.');
        $dir=sys_get_temp_dir().'/credit_pdf_'.bin2hex(random_bytes(12));
        abort_unless(mkdir($dir,0700),503,'Не удалось подготовить загрузку. Попробуйте позже.');
        $file=$dir.'/schedule.pdf';$deadline=microtime(true)+85;
        try{
            file_put_contents($file,$bytes);
            $info=$this->process(['pdfinfo',$file],10);
            abort_if(preg_match('/^Encrypted:\s+yes/im',$info),422,'PDF защищён. Загрузите копию без пароля.');
            preg_match('/^Pages:\s+(\d+)/mi',$info,$match);$pages=(int)($match[1]??0);
            abort_unless($pages>0 && $pages<=30,422,'Можно загрузить график до 30 страниц.');
            $text=$this->process(['pdftotext','-layout','-enc','UTF-8',$file,'-'],20);
            $textPages=explode("\f",$text);$extracted=[];$ocrPages=0;
            for($page=1;$page<=$pages;$page++){
                $pageText=$textPages[$page-1]??'';
                if(!$this->parseText($pageText)['rows']){
                    abort_if(++$ocrPages>8,422,'Для распознавания сканов поддерживается до 8 страниц. Разделите документ или загрузите PDF с текстовым слоем.');
                    abort_if(microtime(true)>$deadline-10,422,'Распознавание заняло слишком много времени. Загрузите PDF меньшего размера.');
                    $prefix=$dir.'/page';
                    $this->process(['pdftoppm','-f',(string)$page,'-l',(string)$page,'-scale-to','2000','-r','150','-singlefile','-png',$file,$prefix],min(15,max(1,$deadline-microtime(true))));
                    $pageText=$this->process(['tesseract',$prefix.'.png','stdout','-l','rus+eng','--psm','6','-c','preserve_interword_spaces=1'],min(15,max(1,$deadline-microtime(true))));
                    @unlink($prefix.'.png');
                }
                $extracted[]=$pageText;
            }
            $parsed=$this->parseText(implode("\n",$extracted));$source=$ocrPages?($ocrPages===$pages?'PDF_OCR':'PDF_MIXED'):'PDF_TEXT';
            abort_unless($parsed['rows'],422,'Не удалось выделить таблицу платежей. Нужен график с датами и отдельными столбцами сумм; CSV и ручной ввод остаются доступны.');
            return [...$parsed,'pages'=>$pages,'source'=>$source,'warnings'=>[$ocrPages?'Это распознавание скана: особенно внимательно проверьте цифры и даты.':'Проверьте извлечённые даты и суммы по документу.','Сопоставьте столбцы. Затем укажите дату и основной долг на начало графика. Сохранение выполняется отдельно.']];
        }finally{
            foreach(glob($dir.'/*')?:[] as $temporary)@unlink($temporary);
            @rmdir($dir);
        }
    }
    public function parseText(string $text): array
    {
        $rows=[];$skipped=0;
        foreach(preg_split('/\R|\f/u',str_replace(["\xc2\xa0","\xe2\x80\xaf"],' ',$text)) as $line){
            if(!preg_match_all('/\b(?:\d{2}\.\d{2}\.\d{4}|\d{4}-\d{2}-\d{2})\b/u',$line,$matches,PREG_OFFSET_CAPTURE))continue;
            $date=$matches[0][0][0];$offset=$matches[0][0][1];$after=substr($line,$offset+strlen($date));
            if(count($matches[0])>1){$skipped++;continue;}
            try{$format=str_contains($date,'.')?'d.m.Y':'Y-m-d';$parsed=CarbonImmutable::createFromFormat('!'.$format,$date);if(!$parsed||$parsed->format($format)!==$date){$skipped++;continue;}$date=$parsed->toDateString();}catch(\Throwable){$skipped++;continue;}
            $values=[];
            $number='(?:\d{1,3}(?: \d{3})+|\d+)(?:[.,]\d{1,2})?';
            foreach(preg_split('/ {2,}|\t+/u',trim($after)) as $cell){
                if(!preg_match_all('/(?<![\d.,-])'.$number.'(?![\d.,])/u',$cell,$amounts))continue;
                foreach($amounts[0] as $value)$values[]=round((float)str_replace([' ', ','],['','.'],$value),2);
            }
            if(count($values)<3){if($values)$skipped++;continue;}
            abort_if(count($values)>12,422,'В таблице слишком много столбцов. Загрузите отдельный график без дополнительных таблиц.');
            $rows[]=['date'=>$date,'values'=>$values];
        }
        abort_if(count($rows)>600,422,'В графике больше 600 платежей.');
        $columns=array_unique(array_map(fn($row)=>count($row['values']),$rows));
        abort_if(count($columns)>1,422,'В строках PDF различается число сумм. Проверьте документ или используйте CSV: автоматическое сопоставление может потерять данные.');
        return ['rows'=>$rows,'column_count'=>$rows?count($rows[0]['values']):0,'skipped_lines'=>$skipped];
    }
}
