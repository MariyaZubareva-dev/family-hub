<?php
namespace App\Http\Controllers\Api;
use App\Models\FinanceTransaction;
use App\Services\Notifications\TelegramNotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class FinanceTransactionController extends BaseApiController {
 private function writable(Request $r,$familyId,FinanceTransaction $transaction){$m=$this->membership($r,$familyId);abort_unless($m->role==='ADMIN'||$transaction->created_by===$m->user_id,403);return $m;}
 public function index(Request $r):JsonResponse{$m=$this->membership($r);$q=FinanceTransaction::where('family_id',$m->family_id)->orderByDesc('occurred_on')->orderByDesc('created_at');$items=$q->get();$income=(float)$items->where('type','INCOME')->sum('amount');$expense=(float)$items->where('type','EXPENSE')->sum('amount');return response()->json(['data'=>$items,'summary'=>['income'=>$income,'expense'=>$expense,'balance'=>$income-$expense]]);}
 public function store(Request $r):JsonResponse{$m=$this->membership($r);$d=$r->validate(['type'=>['required','in:INCOME,EXPENSE'],'amount'=>['required','numeric','gt:0'],'category'=>['required','string','max:80'],'category_id'=>['nullable','string'],'budget_type'=>['nullable','in:FIXED,FLEXIBLE,FUTURE'],'description'=>['nullable','string','max:255'],'occurred_on'=>['required','date']]);$this->validateCategory($d,$m->family_id);$x=FinanceTransaction::create([...$d,'family_id'=>$m->family_id,'created_by'=>$m->user_id]);$this->checkBudgetWarning($m->family_id, $d['occurred_on']);return response()->json(['data'=>$x],201);}

    private function validateCategory(array $data, string $familyId): void
    {
        if (empty($data['category_id'])) return;
        $category = \App\Models\ExpenseCategory::where('family_id', $familyId)->where('id', $data['category_id'])->where('status', 'ACTIVE')->first();
        abort_unless($category && $category->transaction_type === $data['type'] && $category->name === $data['category'], 422, 'Выберите категорию для этого типа операции.');
    }

    private function checkBudgetWarning(string $familyId, string $occurredOn): void
    {
        try {
            $date = new \DateTimeImmutable($occurredOn);
            $year = (int) $date->format('Y');
            $month = (int) $date->format('n');
            $budget = DB::table('budgets')->where(['family_id' => $familyId, 'year' => $year, 'month' => $month])->first();
            if (!$budget) return;
            $spent = (float) DB::table('finance_transactions')->where('family_id', $familyId)->where('type', 'EXPENSE')->whereYear('occurred_on', $year)->whereMonth('occurred_on', $month)->sum('amount');
            $limit = (float) $budget->total_limit;
            if ($limit <= 0) return;
            $percent = $limit > 0 ? round($spent / $limit * 100, 1) : 0;
            if ($percent >= 80) {
                $admins = DB::table('family_members')->where('family_id', $familyId)->where('status', 'ACTIVE')->where('role', 'ADMIN')->get();
                foreach ($admins as $admin) {
                    TelegramNotificationService::notifyBudgetWarning($familyId, $admin->id, 'Общий бюджет ' . $year . '/' . str_pad((string)$month, 2, '0', STR_PAD_LEFT), $spent, $limit, $percent);
                }
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning('Budget warning check failed', ['error' => $e->getMessage()]);
        }
    }
 public function update(Request $r,FinanceTransaction $transaction):JsonResponse{$m=$this->writable($r,$transaction->family_id,$transaction);$d=$r->validate(['type'=>['sometimes','in:INCOME,EXPENSE'],'amount'=>['sometimes','numeric','gt:0'],'category'=>['sometimes','string','max:80'],'category_id'=>['nullable','string'],'budget_type'=>['nullable','in:FIXED,FLEXIBLE,FUTURE'],'description'=>['nullable','string','max:255'],'occurred_on'=>['sometimes','date']]);$this->validateCategory([...$transaction->toArray(),...$d],$m->family_id);$transaction->update($d);return response()->json(['data'=>$transaction->fresh()]);}
 public function destroy(Request $r,FinanceTransaction $transaction):JsonResponse{$this->writable($r,$transaction->family_id,$transaction);$transaction->delete();return response()->json([],204);}
}
