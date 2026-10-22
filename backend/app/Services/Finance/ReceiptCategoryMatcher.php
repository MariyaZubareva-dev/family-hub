<?php

namespace App\Services\Finance;

use Illuminate\Support\Facades\DB;

class ReceiptCategoryMatcher
{
    public function categorize(string $familyId, array $payload): array
    {
        if (empty($payload['items'])) return $payload;
        $categories = DB::table('expense_categories')->where('family_id',$familyId)
            ->where('transaction_type','EXPENSE')->where('status','ACTIVE')->whereNull('deleted_at')->get(['id','name']);
        $byId = $categories->keyBy('id');
        $byName = $categories->keyBy(fn($c)=>$this->normalize($c->name));
        // Learn only from actual expenses belonging to confirmed receipts in this family.
        // Latest confirmed choice wins, including a deliberate manual correction to "Покупки".
        $history = DB::table('finance_transactions as t')->join('receipts as r','r.id','=','t.receipt_id')
            ->where('t.family_id',$familyId)->where('r.family_id',$familyId)->where('t.type','EXPENSE')
            ->where('r.ocr_status','CONFIRMED')->whereNull('r.deleted_at')->whereNotNull('t.category_id')
            ->orderByDesc('t.created_at')->orderByDesc('t.id')->limit(2000)->get(['t.description','t.category_id']);
        $learned = [];
        foreach ($history as $row) {
            $name = $this->normalize($row->description ?? '');
            if ($name !== '' && !isset($learned[$name]) && isset($byId[$row->category_id])) $learned[$name]=$byId[$row->category_id];
        }
        foreach ($payload['items'] as &$item) {
            $name = $this->normalize($item['name'] ?? '');
            $category = $learned[$name] ?? null;
            $source = $category ? 'HISTORY' : 'RULE';
            if (!$category && $name !== '') {
                // Prefer an unambiguous, explicit custom category name (e.g. "Кофе").
                $explicit = $categories->filter(fn($c)=>!in_array($this->normalize($c->name),['покупки','другое','прочее'],true)
                    && mb_strlen($this->normalize($c->name))>=3 && $this->contains($name,preg_quote($this->normalize($c->name),'~')));
                if ($explicit->count()===1) $category=$explicit->first();
                elseif ($explicit->count()===0) {
                    foreach ($this->rules() as [$pattern,$aliases]) {
                        if (!$this->contains($name,$pattern)) continue;
                        foreach ($aliases as $alias) {
                            if (isset($byName[$this->normalize($alias)])) { $category=$byName[$this->normalize($alias)]; break; }
                        }
                        // A missing household/pet category must not turn a scented product into food.
                        break;
                    }
                }
            }
            if (!$category) {
                $category=$byName['покупки'] ?? $byName['другое'] ?? $byName['прочее'] ?? null;
                $source='MANUAL_REVIEW';
            }
            $item['category']=$category?->name ?? '';
            $item['category_id']=$category?->id;
            $item['category_source']=$source;
            $item['category_needs_review']=$source==='MANUAL_REVIEW';
        }
        unset($item);
        return $payload;
    }

    private function normalize(string $value): string
    {
        return trim(preg_replace('/[^\p{L}\p{N}]+/u',' ',str_replace('ё','е',mb_strtolower($value))));
    }

    private function contains(string $name, string $pattern): bool
    {
        return (bool)preg_match('~(?:^| )('.$pattern.')(?: |$)~u',$name);
    }

    private function rules(): array
    {
        return [
            ['(?:корм|лакомство|наполнитель) (?:для )?(?:кош\p{L}*|кот\p{L}*|собак\p{L}*|щен\p{L}*|животн\p{L}*)',['Питомцы','Животные','Зоотовары']],
            ['подгузник\p{L}*|памперс\p{L}*|соск\p{L}*|пустышк\p{L}*',['Дети','Детские товары','Для детей']],
            ['шампун\p{L}*|мыло|зубн\p{L}* (?:паст\p{L}*|щетк\p{L}*)|туалетн\p{L}* бумаг\p{L}*|салфетк\p{L}*|(?:стиральн\p{L}* порош\p{L}*|гель для (?:душа|стирки)|средство для (?:мытья|стирки|уборки))',['Дом. хоз-во','Бытовая химия','Хозтовары','Для дома']],
            ['парацетамол\p{L}*|ибупрофен\p{L}*|нурофен\p{L}*|амоксициллин\p{L}*|аспирин\p{L}*|лекарств\p{L}*|витамины|таблетк\p{L}*|медицинск\p{L}*|стоматолог\p{L}*|терапевт\p{L}*|педиатр\p{L}*|врача|узи|мрт|анализ крови',['Здоровье','Медицина','Аптека','Лекарства','Медицинские услуги']],
            ['крем для (?:лица|рук|тела)|помад\p{L}*|тушь|косметик\p{L}*|духи|дезодорант\p{L}*',['Красота','Косметика','Уход за собой','Дом. хоз-во']],
            ['бензин\p{L}*|дизель\p{L}*|аи 9[258]|моторн\p{L}* масло|автомойк\p{L}*',['Автомобиль','Авто','Транспорт']],
            ['проезд|такси|метро|автобус\p{L}*|трамва\p{L}*',['Транспорт']],
            ['футболк\p{L}*|брюк\p{L}*|джинс\p{L}*|плать\p{L}*|носки|куртк\p{L}*|кроссовк\p{L}*|ботинк\p{L}*|обувь',['Одежда','Одежда и обувь','Обувь']],
            ['тетрад\p{L}*|учебник\p{L}*|канцтовар\p{L}*|обучени\p{L}*',['Образование','Учеба','Канцелярия']],
            ['молоко|кефир\p{L}*|творог\p{L}*|йогурт\p{L}*|сметан\p{L}*|сыр\p{L}*|ряженк\p{L}*',['Молочные продукты','Продукты','Продукты питания','Еда']],
            ['хлеб\p{L}*|батон\p{L}*|булочк\p{L}*|мясо|говядин\p{L}*|свинин\p{L}*|куриц\p{L}*|филе|рыба|лосось|яйц\p{L}*|яблок\p{L}*|банан\p{L}*|апельсин\p{L}*|мандарин\p{L}*|огур\p{L}*|помидор\p{L}*|томат\p{L}*|картофел\p{L}*|морков\p{L}*|капуст\p{L}*|рис|греч\p{L}*|макарон\p{L}*|крупа|сахар|соль|мука|кофе|чай|сок|вода|печень\p{L}*|шоколад\p{L}*|конфет\p{L}*|колбас\p{L}*|сосиск\p{L}*|масло (?:сливочное|подсолнечное|оливковое)',['Продукты','Продукты питания','Еда']],
        ];
    }
}
