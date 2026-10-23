<?php
namespace App\Services\Finance;

class CashbackBankCatalog
{
    public static function all(): array{return config('cashback_banks',[]);}
    private static function token(string $name): string{return preg_replace('/[^\pL\pN]+/u','',str_replace('ё','е',mb_strtolower(trim($name))));}
    public static function find(string $name): ?array
    {
        $key=self::token($name);
        foreach(self::all() as $bank)foreach([$bank['name'],$bank['legal_name'],...$bank['aliases']] as $alias)if(self::token($alias)===$key)return $bank;
        return null;
    }
    public static function name(string $name): string{return self::find($name)['name']??trim($name);}
    public static function key(string $name): string{return self::token(self::name($name));}
}
