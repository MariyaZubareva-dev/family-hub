<?php

namespace App\Services\Finance;

/** Local paper isolation for OCR. Coordinates and masks never leave this process. */
class ReceiptPhoto
{
    public function prepare(string $path, string $bytes): array
    {
        $size = @getimagesizefromstring($bytes);
        if (!$size || $size[0]*$size[1] > 16000000) return [];
        $source = @imagecreatefromstring($bytes);
        if (!$source) return [];
        $paper = null;
        try {
            [$parts,$w,$h]=$this->regions($source);
            if ($this->multiple($parts,$w,$h)) {
                // Do not combine purchases or select a receipt accidentally left in the background.
                return ['review_reason'=>'MULTIPLE_RECEIPTS'];
            }
            if ($parts) {
                $points=[];
                foreach ($parts[0]['rows'] as $y=>[$left,$right]) {
                    $points[]=[max(0,$left-2),max(0,$y-2)];
                    $points[]=[min($w-1,$right+2),min($h-1,$y+2)];
                }
                $hull=$this->hull($points);
                $x1=max(0,(int)floor(($parts[0]['minX']-2)*$size[0]/$w));
                $y1=max(0,(int)floor(($parts[0]['minY']-2)*$size[1]/$h));
                $x2=min($size[0],(int)ceil(($parts[0]['maxX']+3)*$size[0]/$w));
                $y2=min($size[1],(int)ceil(($parts[0]['maxY']+3)*$size[1]/$h));
                $paper=imagecreatetruecolor($x2-$x1,$y2-$y1);
                imagefill($paper,0,0,imagecolorallocate($paper,255,255,255));
                // Copy only the paper polygon. White margins replace the table/background.
                for ($y=$y1;$y<$y2;$y++) {
                    $sy=$y*$h/$size[1]; $intersections=[];
                    for ($i=0,$n=count($hull);$i<$n;$i++) {
                        [$ax,$ay]=$hull[$i]; [$bx,$by]=$hull[($i+1)%$n];
                        if (($ay<=$sy && $by>$sy)||($by<=$sy && $ay>$sy)) $intersections[]=$ax+($sy-$ay)*($bx-$ax)/($by-$ay);
                    }
                    if (count($intersections)<2) continue;
                    $left=max($x1,(int)floor(min($intersections)*$size[0]/$w));
                    $right=min($x2,(int)ceil(max($intersections)*$size[0]/$w));
                    if ($right>$left) imagecopy($paper,$source,$left-$x1,$y-$y1,$left,$y,$right-$left,1);
                }
                imagedestroy($source); $source=$paper; $paper=null;
            }
            $scale=min(2,3200/max(imagesx($source),imagesy($source)));
            $paper=imagescale($source,max(1,(int)round(imagesx($source)*$scale)),max(1,(int)round(imagesy($source)*$scale)),IMG_BICUBIC_FIXED);
            if ($paper) imagepng($paper,$path,1);
            return [];
        } finally {
            if ($paper) imagedestroy($paper);
            imagedestroy($source);
        }
    }

    public function hasMultiple($source): bool
    {
        return $this->multiple(...$this->regions($source));
    }

    private function multiple(array $parts,int $w,int $h): bool
    {
        return isset($parts[1]) && $parts[1]['area']>$parts[0]['area']*.35 && $parts[1]['area']>$w*$h*.05;
    }

    private function regions($source): array
    {
        $ratio=min(1,320/max(imagesx($source),imagesy($source)));
        $w=max(1,(int)round(imagesx($source)*$ratio)); $h=max(1,(int)round(imagesy($source)*$ratio));
        $sample=imagescale($source,$w,$h,IMG_BILINEAR_FIXED);
        if (!$sample) return [[], $w, $h];
        try {
            imagepalettetotruecolor($sample);
            $mask=str_repeat("\0",$w*$h);
            for ($y=0;$y<$h;$y++) for ($x=0;$x<$w;$x++) {
                $rgb=imagecolorat($sample,$x,$y);
                $r=($rgb>>16)&255; $g=($rgb>>8)&255; $b=$rgb&255;
                $hi=max($r,$g,$b); $lo=min($r,$g,$b);
                if ($hi>140 && $lo>90 && $hi-$lo<$hi*.24) $mask[$y*$w+$x]="\1";
            }
            $parts=[];
            for ($seed=0;$seed<$w*$h;$seed++) {
                if ($mask[$seed]!=="\1") continue;
                $queue=new \SplQueue(); $queue->enqueue($seed); $mask[$seed]="\0";
                $area=0; $rows=[]; $minX=$w; $maxX=0; $minY=$h; $maxY=0;
                while (!$queue->isEmpty()) {
                    $index=$queue->dequeue(); $y=intdiv($index,$w); $x=$index%$w; $area++;
                    $minX=min($minX,$x); $maxX=max($maxX,$x); $minY=min($minY,$y); $maxY=max($maxY,$y);
                    $rows[$y]=[min($rows[$y][0]??$x,$x),max($rows[$y][1]??$x,$x)];
                    foreach ([$x>0?$index-1:-1,$x<$w-1?$index+1:-1,$y>0?$index-$w:-1,$y<$h-1?$index+$w:-1] as $next) {
                        if ($next>=0 && $mask[$next]==="\1") { $mask[$next]="\0"; $queue->enqueue($next); }
                    }
                }
                if ($area<max(300,$w*$h*.02) || $maxX-$minX<$w*.15 || $maxY-$minY<$h*.1) continue;
                $parts[]=compact('area','rows','minX','maxX','minY','maxY');
            }
            usort($parts,fn($a,$b)=>$b['area']<=>$a['area']);
            return [$parts,$w,$h];
        } finally { imagedestroy($sample); }
    }

    private function hull(array $points): array
    {
        usort($points,fn($a,$b)=>($a[0]<=>$b[0])?:($a[1]<=>$b[1]));
        $cross=fn($o,$a,$b)=>($a[0]-$o[0])*($b[1]-$o[1])-($a[1]-$o[1])*($b[0]-$o[0]);
        $lower=[]; $upper=[];
        foreach ($points as $p) {
            while (count($lower)>1 && $cross($lower[count($lower)-2],end($lower),$p)<=0) array_pop($lower);
            $lower[]=$p;
        }
        foreach (array_reverse($points) as $p) {
            while (count($upper)>1 && $cross($upper[count($upper)-2],end($upper),$p)<=0) array_pop($upper);
            $upper[]=$p;
        }
        array_pop($lower); array_pop($upper);
        return [...$lower,...$upper];
    }
}
