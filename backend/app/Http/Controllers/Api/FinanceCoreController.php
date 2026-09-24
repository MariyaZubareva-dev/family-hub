<?php

namespace App\Http\Controllers\Api;

use App\Models\ExpenseCategory;
use App\Services\Notifications\TelegramNotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

class FinanceCoreController extends FinanceBaseController
{
    public function analytics(Request $request): JsonResponse
    {
        $m = $this->adminMembership($request);
        $rows = DB::table('finance_transactions')->where('family_id', $m->family_id)->where('type', 'EXPENSE')->get();
        $total = round((float) $rows->sum('amount'), 2);
        $chart = $rows->groupBy('category')->map(function ($items, $category) use ($total) {
            $amount = round((float) $items->sum('amount'), 2);
            return ['name' => $category, 'amount' => $amount, 'percent' => $total > 0 ? round($amount / $total * 100, 1) : 0];
        })->sortByDesc('amount')->values()->all();
        return response()->json(['data' => ['total_expense' => $total, 'expense_chart' => $chart]]);
    }

    public function aiReview(Request $request): JsonResponse
    {
        $m=$this->adminMembership($request);
        $rows=DB::table('finance_transactions')->where('family_id',$m->family_id)->orderByDesc('occurred_on')->limit(500)->get();
        $income=round((float)$rows->where('type','INCOME')->sum('amount'),2);
        $expense=round((float)$rows->where('type','EXPENSE')->sum('amount'),2);
        $categories=$rows->where('type','EXPENSE')->groupBy('category')->map(fn($x)=>round((float)$x->sum('amount'),2))->sortDesc()->take(8)->all();
        $payload=['income'=>$income,'expense'=>$expense,'balance'=>round($income-$expense,2),'top_expense_categories'=>$categories];
        if(env('OPENAI_API_KEY')){
            try{
                $model = env('OPENAI_MODEL','gpt-4o-mini');
                $resp=Http::withToken(env('OPENAI_API_KEY'))->timeout(30)->post('https://api.openai.com/v1/responses',['model'=>$model,'input'=>'Сделай короткий финансовый разбор для семьи на русском. Используй только эти агрегированные данные, без персональных данных. Дай 3 наблюдения и 3 практических действия. JSON не нужен. Данные: '.json_encode($payload,JSON_UNESCAPED_UNICODE)]);
                if($resp->successful()){
                    $json=$resp->json();
                    $text=$json['output'][0]['content'][0]['text'] ?? null;
                    if(!$text && isset($json['output_text'])) $text=$json['output_text'];
                    return response()->json(['data'=>['text'=>$text??json_encode($json,JSON_UNESCAPED_UNICODE),'source'=>'openai','model'=>$model]]);
                } else {
                    \Illuminate\Support\Facades\Log::warning('OpenAI aiReview failed', ['status'=>$resp->status(),'body'=>mb_substr($resp->body(),0,1000),'model'=>$model]);
                }
            }catch(\Throwable $e){\Illuminate\Support\Facades\Log::warning('OpenAI aiReview exception', ['error'=>$e->getMessage()]); report($e);}
        }
        $text='Доходы: '.number_format($income,2,',',' ').' ₽. Расходы: '.number_format($expense,2,',',' ').' ₽. Баланс: '.number_format($income-$expense,2,',',' ').' ₽.\n';
        $text.=$expense>0?'Наблюдение: расходная часть составляет '.round($expense/max(1,$income)*100,1).'% от доходов.\n':'';
        $text.='Действия: задайте месячный лимит, внесите крупные финансовые цели и регулярно проверяйте категории с максимальными расходами.';
        return response()->json(['data'=>['text'=>$text,'source'=>'local_rules']]);
    }

    public function categories(Request $request): JsonResponse
    {
        $m = $this->adminMembership($request);
        return response()->json(['data' => ExpenseCategory::query()->where('family_id', $m->family_id)->where('status', 'ACTIVE')->orderBy('name')->get()]);
    }

    public function saveBudget(Request $request): JsonResponse
    {
        $m = $this->adminMembership($request);
        $d = $request->validate(['year' => ['required','integer'], 'month' => ['required','integer','between:1,12'], 'total_limit' => ['required','numeric','min:0'], 'categories' => ['array'], 'categories.*.category_id' => ['required','string'], 'categories.*.limit_amount' => ['required','numeric','min:0']]);
        $budget = DB::table('budgets')->where(['family_id'=>$m->family_id,'year'=>$d['year'],'month'=>$d['month']])->first();
        if ($budget) {
            DB::table('budgets')->where('id',$budget->id)->update(['total_limit'=>$d['total_limit'],'updated_at'=>now()]);
            $budgetId = $budget->id;
        } else {
            $budgetId = (string) Str::ulid();
            DB::table('budgets')->insert(['id'=>$budgetId,'family_id'=>$m->family_id,'year'=>$d['year'],'month'=>$d['month'],'total_limit'=>$d['total_limit'],'status'=>'ACTIVE','created_by'=>$m->user_id,'created_at'=>now(),'updated_at'=>now()]);
        }
        DB::table('budget_categories')->where('budget_id',$budgetId)->delete();
        foreach ($d['categories'] ?? [] as $cat) {
            $this->activeCategory($m->family_id, $cat['category_id']);
            DB::table('budget_categories')->insert(['id'=>(string)Str::ulid(),'budget_id'=>$budgetId,'category_id'=>$cat['category_id'],'limit_amount'=>$cat['limit_amount'],'created_at'=>now(),'updated_at'=>now()]);
        }
        return $this->budgetResponse($m->family_id, $d['year'], $d['month']);
    }

    public function budget(Request $request, int $year, int $month): JsonResponse
    {
        $m = $this->adminMembership($request);
        return $this->budgetResponse($m->family_id, $year, $month);
    }

    private function budgetResponse(string $familyId, int $year, int $month): JsonResponse
    {
        $budget = DB::table('budgets')->where('family_id',$familyId)->where('year',$year)->where('month',$month)->first();
        $spent = (float) DB::table('finance_transactions')->where('family_id',$familyId)->where('type','EXPENSE')->whereYear('occurred_on',$year)->whereMonth('occurred_on',$month)->sum('amount');
        $cats = [];
        if ($budget) {
            $cats = DB::table('budget_categories')->join('expense_categories','expense_categories.id','=','budget_categories.category_id')->where('budget_categories.budget_id',$budget->id)->get(['budget_categories.category_id','budget_categories.limit_amount','expense_categories.name','expense_categories.icon'])->map(function($x) use ($familyId,$year,$month){
                $spent = (float) DB::table('finance_transactions')->where('family_id',$familyId)->where('type','EXPENSE')->where('category',$x->name)->whereYear('occurred_on',$year)->whereMonth('occurred_on',$month)->sum('amount');
                return ['category_id'=>$x->category_id,'name'=>$x->name,'icon'=>$x->icon,'limit_amount'=>(float)$x->limit_amount,'spent_amount'=>round($spent,2),'remaining_amount'=>round((float)$x->limit_amount-$spent,2),'progress_percent'=>(float)$x->limit_amount>0?min(100,round($spent/(float)$x->limit_amount*100,1)):0];
            })->values()->all();
        }
        return response()->json(['data'=>['budget'=>['id'=>$budget?->id,'total_limit'=>(float)($budget?->total_limit??0),'spent_amount'=>round($spent,2),'available_amount'=>round((float)($budget?->total_limit??0)-$spent,2),'categories'=>$cats]]]);
    }

    public function goals(Request $request): JsonResponse
    {
        $m = $this->adminMembership($request);
        $goals = DB::table('financial_goals')->where('family_id',$m->family_id)->whereNull('deleted_at')->orderByDesc('created_at')->get();
        $goals = $goals->map(function($g){
            $g->target_amount=(float)$g->target_amount; $g->current_price=$g->current_price===null?null:(float)$g->current_price;
            $g->contributions=DB::table('goal_contributions')->where('goal_id',$g->id)->orderByDesc('contribution_date')->get()->map(fn($x)=>array_merge((array)$x,['amount'=>(float)$x->amount]));
            $g->price_history=DB::table('goal_price_history')->where('goal_id',$g->id)->orderByDesc('recorded_at')->get()->map(fn($x)=>array_merge((array)$x,['price'=>(float)$x->price]));
            return $g;
        });
        return response()->json(['data'=>$goals]);
    }

    public function createGoal(Request $request): JsonResponse
    {
        $m=$this->adminMembership($request); $d=$request->validate(['name'=>'required|string|max:255','type'=>'required|string|max:32','target_amount'=>'required|numeric|min:0.01','category_id'=>'nullable|string','target_date'=>'nullable|date','priority'=>'nullable|string|max:32','current_price'=>'nullable|numeric|min:0','url'=>'nullable|string','description'=>'nullable|string','status'=>'nullable|string|max:32']);
        $id=(string)Str::ulid(); DB::table('financial_goals')->insert(['id'=>$id,'family_id'=>$m->family_id,'name'=>$d['name'],'type'=>$d['type'],'target_amount'=>$d['target_amount'],'category_id'=>$d['category_id']??null,'target_date'=>$d['target_date']??null,'priority'=>$d['priority']??'MEDIUM','current_price'=>$d['current_price']??null,'url'=>$d['url']??null,'description'=>$d['description']??null,'status'=>$d['status']??'PLANNED','created_by'=>$m->user_id,'created_at'=>now(),'updated_at'=>now()]); return $this->goals($request);
    }

    public function updateGoal(Request $request,string $goal): JsonResponse { $m=$this->adminMembership($request); $d=$request->validate(['name'=>'sometimes|string|max:255','target_amount'=>'sometimes|numeric|min:0.01','target_date'=>'nullable|date','priority'=>'sometimes|string|max:32','current_price'=>'nullable|numeric|min:0','url'=>'nullable|string','description'=>'nullable|string','status'=>'sometimes|string|max:32']); $this->ownedRow('financial_goals',$goal,$m->family_id); DB::table('financial_goals')->where('id',$goal)->update([...$d,'updated_at'=>now()]); return $this->goals($request); }
    public function deleteGoal(Request $request,string $goal): JsonResponse { $m=$this->adminMembership($request); $this->ownedRow('financial_goals',$goal,$m->family_id); DB::table('financial_goals')->where('id',$goal)->update(['deleted_at'=>now()]); return response()->json([],204); }
    public function contribution(Request $request,string $goal): JsonResponse { $m=$this->adminMembership($request); $this->ownedRow('financial_goals',$goal,$m->family_id); $d=$request->validate(['amount'=>'required|numeric|min:0.01','contribution_date'=>'required|date']); DB::table('goal_contributions')->insert(['id'=>(string)Str::ulid(),'goal_id'=>$goal,'amount'=>$d['amount'],'contribution_date'=>$d['contribution_date'],'created_by'=>$m->user_id,'created_at'=>now(),'updated_at'=>now()]); return $this->goals($request); }
    public function price(Request $request,string $goal): JsonResponse { $m=$this->adminMembership($request); $this->ownedRow('financial_goals',$goal,$m->family_id); $d=$request->validate(['price'=>'required|numeric|min:0','recorded_at'=>'required','url'=>'nullable|string','comment'=>'nullable|string']); DB::table('goal_price_history')->insert(['id'=>(string)Str::ulid(),'goal_id'=>$goal,'price'=>$d['price'],'url'=>$d['url']??null,'comment'=>$d['comment']??null,'recorded_at'=>$d['recorded_at'],'created_by'=>$m->user_id,'created_at'=>now()]); DB::table('financial_goals')->where('id',$goal)->update(['current_price'=>$d['price'],'updated_at'=>now()]); return $this->goals($request); }

    public function cards(Request $request): JsonResponse { $m=$this->adminMembership($request); return response()->json(['data'=>DB::table('finance_cards')->where('family_id',$m->family_id)->whereNull('deleted_at')->orderBy('name')->get()->map(fn($x)=>array_merge((array)$x,['default_cashback_rate'=>(float)$x->default_cashback_rate]))]); }
    public function createCard(Request $request): JsonResponse { $m=$this->adminMembership($request); $d=$request->validate(['name'=>'required|string|max:120','bank_name'=>'nullable|string|max:120','last4'=>'nullable|digits:4','payment_system'=>'nullable|string|max:40','default_cashback_rate'=>'nullable|numeric|min:0']); DB::table('finance_cards')->insert(['id'=>(string)Str::ulid(),'family_id'=>$m->family_id,'name'=>$d['name'],'bank_name'=>$d['bank_name']??null,'last4'=>$d['last4']??null,'payment_system'=>$d['payment_system']??null,'default_cashback_rate'=>$d['default_cashback_rate']??0,'status'=>'ACTIVE','created_by'=>$m->user_id,'created_at'=>now(),'updated_at'=>now()]); return $this->cards($request); }
    public function deleteCard(Request $request,string $card): JsonResponse { $m=$this->adminMembership($request); $this->ownedRow('finance_cards',$card,$m->family_id); DB::table('finance_cards')->where('id',$card)->update(['deleted_at'=>now(),'status'=>'ARCHIVED','updated_at'=>now()]); return response()->json([],204); }

    public function cashback(Request $request): JsonResponse { $m=$this->adminMembership($request); return response()->json(['data'=>DB::table('cashback_offers')->where('family_id',$m->family_id)->whereNull('deleted_at')->orderByDesc('cashback_rate')->get()->map(fn($x)=>array_merge((array)$x,['cashback_rate'=>(float)$x->cashback_rate,'cap_amount'=>$x->cap_amount===null?null:(float)$x->cap_amount]))]); }
    public function createCashback(Request $request): JsonResponse { $m=$this->adminMembership($request); $d=$request->validate(['card_id'=>'nullable|string','merchant_name'=>'nullable|string|max:160','category'=>'nullable|string|max:120','cashback_rate'=>'required|numeric|min:0','cap_amount'=>'nullable|numeric|min:0','valid_from'=>'nullable|date','valid_to'=>'nullable|date','notes'=>'nullable|string']); DB::table('cashback_offers')->insert(['id'=>(string)Str::ulid(),'family_id'=>$m->family_id,'card_id'=>$d['card_id']??null,'merchant_name'=>$d['merchant_name']??null,'category'=>$d['category']??null,'cashback_rate'=>$d['cashback_rate'],'cap_amount'=>$d['cap_amount']??null,'valid_from'=>$d['valid_from']??null,'valid_to'=>$d['valid_to']??null,'notes'=>$d['notes']??null,'created_by'=>$m->user_id,'created_at'=>now(),'updated_at'=>now()]); return $this->cashback($request); }

    public function receipts(Request $request): JsonResponse { $m=$this->adminMembership($request); return response()->json(['data'=>DB::table('receipts')->where('family_id',$m->family_id)->whereNull('deleted_at')->orderByDesc('created_at')->get()->map(fn($x)=>array_merge((array)$x,['ai_result'=>$x->ai_result?json_decode($x->ai_result,true):null]))]); }
    public function uploadReceipt(Request $request): JsonResponse { $m=$this->adminMembership($request); $d=$request->validate(['file_name'=>'nullable|string|max:255','mime_type'=>'nullable|string|max:80','image_data'=>'required|string']); $id=(string)Str::ulid(); DB::table('receipts')->insert(['id'=>$id,'family_id'=>$m->family_id,'uploaded_by'=>$m->user_id,'file_name'=>$d['file_name']??null,'mime_type'=>$d['mime_type']??null,'image_data'=>$d['image_data'],'ocr_status'=>'PENDING','created_at'=>now(),'updated_at'=>now()]); $this->tryAnalyzeReceipt($id,$m->family_id); // notify ADMIN that receipt is ready for review
        try { TelegramNotificationService::notifyAiReady($m->family_id, $m->id, $id); } catch (\Throwable $e) { report($e); }
        $row=DB::table('receipts')->where('id',$id)->first(); return response()->json(['data'=>array_merge((array)$row,['ai_result'=>$row->ai_result?json_decode($row->ai_result,true):null])],201); }

    private function tryAnalyzeReceipt(string $id,string $familyId): void
    {
        $row=DB::table('receipts')->where('id',$id)->first(); if(!$row)return;
        $image=$row->image_data; $ocrText=null;
        if(str_starts_with($image,'data:image/')){
            $tmp=tempnam(sys_get_temp_dir(),'fh_receipt_');
            $parts=explode(',', $image,2); if(count($parts)===2){file_put_contents($tmp,base64_decode($parts[1]));}
            $cmd='command -v tesseract'; exec($cmd,$out,$code);
            if($code===0){$escaped=escapeshellarg($tmp);$text=shell_exec("tesseract $escaped stdout -l rus+eng 2>/dev/null");$ocrText=is_string($text)?trim($text):null;}
            @unlink($tmp);
        }
        $result=null; $aiError=null;
        if(env('OPENAI_API_KEY') && is_string($image) && $image!==''){
            try{
                $model = env('OPENAI_MODEL','gpt-4o-mini');
                $isPdf = str_contains($image, 'application/pdf');
                $content = $isPdf
                    ? [['type'=>'input_text','text'=>'Распознай чек в PDF. Верни JSON только с полями merchant,total,date,currency,items. Не придумывай значения. Если поле неизвестно, null.'], ['type'=>'input_file','filename'=>'receipt.pdf','file_data'=>$image]]
                    : [['type'=>'input_text','text'=>'Распознай чек. Верни JSON только с полями merchant,total,date,currency,items. Не придумывай значения. Если поле неизвестно, null.'], ['type'=>'input_image','image_url'=>$image]];
                $resp=Http::withToken(env('OPENAI_API_KEY'))->timeout(60)->post('https://api.openai.com/v1/responses',['model'=>$model,'input'=>[['role'=>'user','content'=>$content]]]);
                if($resp->successful()){
                    $result=['raw'=>$resp->json()];
                } else {
                    $aiError = 'OpenAI '.$resp->status().': '.mb_substr($resp->body(),0,800);
                    \Illuminate\Support\Facades\Log::warning('OpenAI receipt failed', ['status'=>$resp->status(),'body'=>mb_substr($resp->body(),0,1500),'model'=>$model,'isPdf'=>$isPdf]);
                }
            }catch(\Throwable $e){$aiError=$e->getMessage(); report($e); \Illuminate\Support\Facades\Log::warning('OpenAI receipt exception', ['error'=>$e->getMessage()]);}
        }
        $status = $result ? 'READY_FOR_REVIEW' : ($aiError && str_contains($aiError,'PDF parser') ? 'FAILED' : ($ocrText||$result ? 'READY_FOR_REVIEW' : 'NOT_CONFIGURED'));
        $update = ['ocr_status'=>$status,'ocr_text'=>$ocrText,'ai_result'=>$result?json_encode($result,JSON_UNESCAPED_UNICODE):($aiError?json_encode(['error'=>$aiError],JSON_UNESCAPED_UNICODE):null),'updated_at'=>now()];
        if($aiError && $status==='FAILED') $update['ocr_text'] = ($ocrText ? $ocrText."\n" : '')."[AI error] ".$aiError;
        DB::table('receipts')->where('id',$id)->update($update);
    }

    private function ownedRow(string $table,string $id,string $familyId): object { $row=DB::table($table)->where('id',$id)->where('family_id',$familyId)->first(); abort_unless($row,404); return $row; }
}
