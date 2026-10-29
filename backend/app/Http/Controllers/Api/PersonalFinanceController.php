<?php

namespace App\Http\Controllers\Api;

use App\Models\FinanceTransaction;
use App\Services\Finance\SavingsLedger as Ledger;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PersonalFinanceController extends BaseApiController
{
    public function index(Request $r): JsonResponse
    {
        $m = $this->membership($r);
        $pots = DB::table('savings_pots')->where(['family_id' => $m->family_id, 'user_id' => $m->user_id])->orderBy('created_at')->get()
            ->map(fn ($p) => [...(array) $p, 'balance' => Ledger::balance($p->id) / 100]);
        $history = DB::table('savings_movements')->where(['family_id' => $m->family_id, 'user_id' => $m->user_id])->orderByDesc('id')->get();
        $income = FinanceTransaction::where(['family_id' => $m->family_id, 'created_by' => $m->user_id, 'type' => 'INCOME'])->orderByDesc('occurred_on')->orderByDesc('id')->get();
        return response()->json(['data' => ['pots' => $pots, 'history' => $history, 'income' => $income, 'available' => Ledger::available($m->family_id) / 100]]);
    }

    public function store(Request $r): JsonResponse
    {
        $m = $this->membership($r);
        $d = $r->validate([
            'name' => 'required|string|max:80', 'target_amount' => 'nullable|numeric|decimal:0,2|gt:0|max:9999999999.99',
            'target_date' => 'nullable|date_format:Y-m-d', 'opening_amount' => 'nullable|numeric|decimal:0,2|min:0|max:9999999999.99',
            'request_key' => 'required|uuid',
        ]);
        abort_if(trim($d['name']) === '', 422, 'Введите название копилки.');
        DB::transaction(function () use ($d, $m) {
            Ledger::lock($m->family_id);
            // Every creation has an opening record, including zero, for retry safety.
            $old = DB::table('savings_movements')->where(['family_id' => $m->family_id, 'request_key' => $d['request_key']])->first();
            if ($old) { abort_unless($old->user_id === $m->user_id && $old->kind === 'OPENING', 409); return; }
            $id = (string) Str::ulid();
            DB::table('savings_pots')->insert(['id' => $id, 'family_id' => $m->family_id, 'user_id' => $m->user_id, 'name' => trim($d['name']), 'target_amount' => $d['target_amount'] ?? null, 'target_date' => $d['target_date'] ?? null, 'created_at' => now(), 'updated_at' => now()]);
            DB::table('savings_movements')->insert(['id' => (string) Str::ulid(), 'family_id' => $m->family_id, 'user_id' => $m->user_id, 'pot_id' => $id, 'kind' => 'OPENING', 'amount' => $d['opening_amount'] ?? 0, 'request_key' => $d['request_key'], 'created_at' => now(), 'updated_at' => now()]);
        });
        return $this->index($r)->setStatusCode(201);
    }

    public function update(Request $r, string $pot): JsonResponse
    {
        $m = $this->membership($r);
        $d = $r->validate(['name' => 'required|string|max:80', 'target_amount' => 'nullable|numeric|decimal:0,2|gt:0|max:9999999999.99', 'target_date' => 'nullable|date_format:Y-m-d']);
        abort_if(trim($d['name']) === '', 422, 'Введите название копилки.');
        DB::transaction(function () use ($m, $pot, $d) {
            Ledger::lock($m->family_id);
            $p = Ledger::ownPot($m->family_id, $m->user_id, $pot);
            abort_if($p->archived_at, 422, 'Копилка закрыта.');
            DB::table('savings_pots')->where('id', $pot)->update([...$d, 'name' => trim($d['name']), 'updated_at' => now()]);
        });
        return $this->index($r);
    }

    public function archive(Request $r, string $pot): JsonResponse
    {
        $m = $this->membership($r);
        DB::transaction(function () use ($m, $pot) {
            Ledger::lock($m->family_id);
            Ledger::ownPot($m->family_id, $m->user_id, $pot);
            abort_if(Ledger::balance($pot) !== 0, 422, 'Сначала верните деньги в бюджет или переведите в другую копилку.');
            DB::table('savings_pots')->where('id', $pot)->update(['archived_at' => now(), 'updated_at' => now()]);
        });
        return $this->index($r);
    }

    public function move(Request $r, string $pot): JsonResponse
    {
        $m = $this->membership($r);
        $d = $r->validate(['kind' => 'required|in:DEPOSIT,WITHDRAW,TRANSFER', 'amount' => 'required|numeric|decimal:0,2|gt:0|max:9999999999.99', 'destination_id' => 'nullable|string', 'note' => 'nullable|string|max:255', 'request_key' => 'required|uuid']);
        DB::transaction(function () use ($m, $pot, $d) {
            Ledger::lock($m->family_id);
            Ledger::ownPot($m->family_id, $m->user_id, $pot);
            $old = DB::table('savings_movements')->where(['family_id' => $m->family_id, 'request_key' => $d['request_key']])->first();
            if ($old) { abort_unless($old->user_id === $m->user_id && $old->pot_id === $pot && $old->kind === $d['kind'] && Ledger::cents($old->amount) === Ledger::cents($d['amount']) && $old->destination_id === ($d['destination_id'] ?? null), 409); return; }
            Ledger::move($m->family_id, $m->user_id, $pot, $d['kind'], Ledger::cents($d['amount']), $d['request_key'], $d['destination_id'] ?? null, $d['note'] ?? null);
        });
        return $this->index($r);
    }

    public function familyHistory(Request $r): JsonResponse
    {
        $m = $this->membership($r);
        // Deliberately excludes pot IDs/names, private notes and opening savings.
        $rows = DB::table('savings_movements as s')->join('users as u', 's.user_id', '=', 'u.id')->where('s.family_id', $m->family_id)->whereIn('s.kind', ['DEPOSIT', 'WITHDRAW'])->orderByDesc('s.id')->limit(100)->get(['s.id', 's.kind', 's.amount', 's.created_at', 'u.first_name', 'u.last_name', 'u.username']);
        return response()->json(['data' => $rows]);
    }
}
