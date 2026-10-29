<?php

namespace App\Services\Finance;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SavingsLedger
{
    public static function cents($amount): int
    {
        return (int) round((float) $amount * 100);
    }

    public static function lock(string $family): void
    {
        DB::table('families')->where('id', $family)->lockForUpdate()->first();
    }

    public static function available(string $family): int
    {
        $q = DB::table('finance_transactions')->where('family_id', $family)->whereDate('occurred_on', '<=', now('Europe/Moscow')->toDateString());
        $income = self::cents((clone $q)->where('type', 'INCOME')->sum('amount'));
        $expense = self::cents((clone $q)->where('type', 'EXPENSE')->sum('amount'));
        $m = DB::table('savings_movements')->where('family_id', $family);
        return $income - $expense - self::cents((clone $m)->where('kind', 'DEPOSIT')->sum('amount'))
            + self::cents((clone $m)->where('kind', 'WITHDRAW')->sum('amount'));
    }

    public static function balance(string $pot): int
    {
        $in = DB::table('savings_movements')->where(function ($q) use ($pot) {
            $q->where(function ($q) use ($pot) { $q->where('pot_id', $pot)->whereIn('kind', ['OPENING', 'DEPOSIT']); })
                ->orWhere('destination_id', $pot);
        })->sum('amount');
        $out = DB::table('savings_movements')->where('pot_id', $pot)->whereIn('kind', ['WITHDRAW', 'TRANSFER'])->sum('amount');
        return self::cents($in) - self::cents($out);
    }

    public static function ownPot(string $family, string $user, string $id): object
    {
        $pot = DB::table('savings_pots')->where(['id' => $id, 'family_id' => $family, 'user_id' => $user])->first();
        abort_unless($pot, 404, 'Копилка не найдена.');
        return $pot;
    }

    // Caller holds the family lock inside a transaction. Never write balances directly.
    public static function move(string $family, string $user, string $potId, string $kind, int $amount, string $key, ?string $destination = null, ?string $note = null): void
    {
        $pot = self::ownPot($family, $user, $potId);
        abort_if($pot->archived_at, 422, 'Копилка закрыта.');
        abort_if($amount <= 0 || $amount > 999999999999, 422, 'Укажите положительную сумму не больше 9 999 999 999,99 ₽.');
        if ($kind === 'DEPOSIT') abort_if($amount > self::available($family), 422, 'В семейном бюджете недостаточно доступных денег.');
        if (in_array($kind, ['WITHDRAW', 'TRANSFER'])) abort_if($amount > self::balance($potId), 422, 'В копилке недостаточно денег.');
        if ($kind === 'TRANSFER') {
            abort_if(!$destination || $destination === $potId, 422, 'Выберите другую свою копилку.');
            $target = self::ownPot($family, $user, $destination);
            abort_if($target->archived_at, 422, 'Копилка получателя закрыта.');
        }
        DB::table('savings_movements')->insert([
            'id' => (string) Str::ulid(), 'family_id' => $family, 'user_id' => $user,
            'pot_id' => $potId, 'destination_id' => $kind === 'TRANSFER' ? $destination : null,
            'kind' => $kind, 'amount' => $amount / 100, 'note' => $note, 'request_key' => $key,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }
}
