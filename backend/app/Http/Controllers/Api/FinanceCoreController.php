<?php

namespace App\Http\Controllers\Api;

use App\Models\ExpenseCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;

class FinanceCoreController extends FinanceBaseController
{
    /**
     * v07 Modern analytics: top5+other donut + ranked + 6m trend
     * Query: ?period=month|3m|6m|year|all&year=2026&month=9
     * Backward compatible: without params returns all-time chart as before + ranked+trend
     */
    public function analytics(Request $request): JsonResponse
    {
        // Allow any active member to view (not just ADMIN) — per v07 spec "фильтр, не изоляция"
        $m = $this->viewMembership($request);
        $familyId = $m->family_id;

        $period = $request->query('period');
        $year = $request->query('year');
        $month = $request->query('month');

        // Normalize period: if year+month given and no period, assume month
        if (!$period && $year && $month) $period = 'month';
        if (!$period) $period = 'all';

        // Build base query with period filter for totals/chart/ranked
        $expenseQuery = DB::table('finance_transactions')->where('family_id', $familyId)->where('type', 'EXPENSE');
        $incomeQuery = DB::table('finance_transactions')->where('family_id', $familyId)->where('type', 'INCOME');

        // Apply period filter
        $this->applyPeriodFilter($expenseQuery, $period, $year, $month);
        $this->applyPeriodFilter($incomeQuery, $period, $year, $month);

        $expenseRows = $expenseQuery->get();
        $incomeRows = $incomeQuery->get();

        $totalExpense = round((float) $expenseRows->sum('amount'), 2);
        $totalIncome = round((float) $incomeRows->sum('amount'), 2);
        $balance = round($totalIncome - $totalExpense, 2);

        // Group by category (string) — enrich with ExpenseCategory meta
        $grouped = $expenseRows->groupBy('category');
        $allCatsMeta = DB::table('expense_categories')->where('family_id', $familyId)->where('status','ACTIVE')->get()->keyBy(fn($c)=>mb_strtolower($c->name));

        $chartAll = $grouped->map(function ($items, $category) use ($totalExpense, $allCatsMeta) {
            $amount = round((float) $items->sum('amount'), 2);
            $meta = $allCatsMeta->get(mb_strtolower($category));
            return [
                'id' => $meta?->id ?? md5($category),
                'name' => $category,
                'icon' => $meta?->icon ?? '•',
                'color' => $meta?->color ?? '#9CA3AF',
                'amount' => $amount,
                'percent' => $totalExpense > 0 ? round($amount / $totalExpense * 100, 1) : 0,
            ];
        })->sortByDesc('amount')->values();

        // Ranked = full sorted list with budget/limit info for the requested month (if month given)
        $ranked = $chartAll->map(function($c) use ($familyId, $year, $month) {
            $limit = null;
            $budget = null;
            if ($year && $month) {
                $budgetRow = DB::table('budgets')->where('family_id',$familyId)->where('year',$year)->where('month',$month)->first();
                if ($budgetRow && $c['id']) {
                    // Try find budget_categories by category_id
                    $bc = DB::table('budget_categories')->where('budget_id',$budgetRow->id)->where('category_id',$c['id'])->first();
                    if (!$bc) {
                        // Fallback by name match via expense_categories
                        $catByName = DB::table('expense_categories')->where('family_id',$familyId)->where('name',$c['name'])->first();
                        if ($catByName) $bc = DB::table('budget_categories')->where('budget_id',$budgetRow->id)->where('category_id',$catByName->id)->first();
                    }
                    if ($bc) {
                        $limit = (float) $bc->limit_amount;
                    }
                }
            }
            return array_merge($c, [
                'limit_amount' => $limit,
                'is_over' => $limit !== null ? $c['amount'] > $limit : false,
                'progress_percent' => $limit ? min(100, round($c['amount']/$limit*100,1)) : null,
            ]);
        })->values()->all();

        // Donut = top5 + Other (as frontend expects)
        $top5 = collect($chartAll)->take(5)->values();
        $otherAmount = $totalExpense - $top5->sum('amount');
        $donut = $top5->all();
        if ($otherAmount > 0.01 && count($chartAll) > 5) {
            $donut[] = [
                'id' => 'other',
                'name' => 'Остальные '.(count($chartAll)-5),
                'icon' => '•',
                'color' => '#9CA3AF',
                'amount' => round($otherAmount,2),
                'percent' => $totalExpense>0 ? round($otherAmount/$totalExpense*100,1) : 0,
            ];
        }

        // Trend — last 6 months including current, income vs expense per month
        $trend = $this->buildTrend($familyId, 6);

        // Also include legacy expense_chart for backward compat (same as ranked without meta)
        $legacyChart = $chartAll;

        return response()->json(['data' => [
            'total_expense' => $totalExpense,
            'total_income' => $totalIncome,
            'balance' => $balance,
            // Modern fields
            'donut' => $donut,
            'ranked' => $ranked,
            'trend' => $trend,
            // Legacy
            'expense_chart' => $legacyChart,
            // Meta
            'period' => $period,
            'year' => $year ? (int)$year : null,
            'month' => $month ? (int)$month : null,
            'categories_count' => count($chartAll),
        ]]);
    }

    private function applyPeriodFilter($query, ?string $period, $year, $month): void
    {
        if ($period === 'month' && $year && $month) {
            $query->whereYear('occurred_on', $year)->whereMonth('occurred_on', $month);
        } elseif ($period === '3m') {
            $query->where('occurred_on', '>=', Carbon::now()->subMonths(2)->startOfMonth());
        } elseif ($period === '6m') {
            $query->where('occurred_on', '>=', Carbon::now()->subMonths(5)->startOfMonth());
        } elseif ($period === 'year' && $year) {
            $query->whereYear('occurred_on', $year);
        } elseif ($period === 'year' && !$year) {
            $query->whereYear('occurred_on', Carbon::now()->year);
        }
        // 'all' => no filter
    }

    private function buildTrend(string $familyId, int $months = 6): array
    {
        $result = [];
        $now = Carbon::now()->startOfMonth();
        for ($i = $months -1; $i >= 0; $i--) {
            $date = $now->copy()->subMonths($i);
            $y = $date->year;
            $m = $date->month;
            $income = (float) DB::table('finance_transactions')->where('family_id',$familyId)->where('type','INCOME')->whereYear('occurred_on',$y)->whereMonth('occurred_on',$m)->sum('amount');
            $expense = (float) DB::table('finance_transactions')->where('family_id',$familyId)->where('type','EXPENSE')->whereYear('occurred_on',$y)->whereMonth('occurred_on',$m)->sum('amount');
            $result[] = [
                'month' => $date->format('Y-m'),
                'label' => $this->monthLabel($m),
                'year' => $y,
                'month_num' => $m,
                'income' => round($income,2),
                'expense' => round($expense,2),
            ];
        }
        return $result;
    }

    private function monthLabel(int $m): string
    {
        return ['','Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'][$m] ?? (string)$m;
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
                $resp=Http::withToken(env('OPENAI_API_KEY'))->timeout(30)->post('https://api.openai.com/v1/responses',['model'=>env('OPENAI_MODEL','gpt-5.6-luna'),'input'=>'Сделай короткий финансовый разбор для семьи на русском. Используй только эти агрегированные данные, без персональных данных. Дай 3 наблюдения и 3 практических действия. JSON не нужен. Данные: '.json_encode($payload,JSON_UNESCAPED_UNICODE)]);
                if($resp->successful()){
                    $json=$resp->json();
                    return response()->json(['data'=>['text'=>$json['output'][0]['content'][0]['text']??json_encode($json,JSON_UNESCAPED_UNICODE),'source'=>'openai']]);
                }
            }catch(\Throwable $e){report($e);}
        }
        $text='Доходы: '.number_format($income,2,',',' ').' ₽. Расходы: '.number_format($expense,2,',',' ').' ₽. Баланс: '.number_format($income-$expense,2,',',' ').' ₽.'."\n";
        $text.=$expense>0?'Наблюдение: расходная часть составляет '.round($expense/max(1,$income)*100,1).'% от доходов.'."\n":'';
        $text.='Действия: задайте месячный лимит, внесите крупные финансовые цели и регулярно проверяйте категории с максимальными расходами.';
        return response()->json(['data'=>['text'=>$text,'source'=>'local_rules']]);
    }

    public function categories(Request $request): JsonResponse
    {
        $m = $this->viewMembership($request);
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
        $m = $this->viewMembership($request);
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
        $m = $this->viewMembership($request);
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

    public function cards(Request $request): JsonResponse { $m=$this->viewMembership($request); return response()->json(['data'=>DB::table('finance_cards')->where('family_id',$m->family_id)->whereNull('deleted_at')->orderBy('name')->get()->map(fn($x)=>array_merge((array)$x,['default_cashback_rate'=>(float)$x->default_cashback_rate]))]); }
    public function createCard(Request $request): JsonResponse { $m=$this->adminMembership($request); $d=$request->validate(['name'=>'required|string|max:120','bank_name'=>'nullable|string|max:120','last4'=>'nullable|digits:4','payment_system'=>'nullable|string|max:40','default_cashback_rate'=>'nullable|numeric|min:0']); DB::table('finance_cards')->insert(['id'=>(string)Str::ulid(),'family_id'=>$m->family_id,'name'=>$d['name'],'bank_name'=>$d['bank_name']??null,'last4'=>$d['last4']??null,'payment_system'=>$d['payment_system']??null,'default_cashback_rate'=>$d['default_cashback_rate']??0,'status'=>'ACTIVE','created_by'=>$m->user_id,'created_at'=>now(),'updated_at'=>now()]); return $this->cards($request); }
    public function deleteCard(Request $request,string $card): JsonResponse { $m=$this->adminMembership($request); $this->ownedRow('finance_cards',$card,$m->family_id); DB::table('finance_cards')->where('id',$card)->update(['deleted_at'=>now(),'status'=>'ARCHIVED','updated_at'=>now()]); return response()->json([],204); }

    public function cashback(Request $request): JsonResponse { $m=$this->viewMembership($request); return response()->json(['data'=>DB::table('cashback_offers')->where('family_id',$m->family_id)->whereNull('deleted_at')->orderByDesc('cashback_rate')->get()->map(fn($x)=>array_merge((array)$x,['cashback_rate'=>(float)$x->cashback_rate,'cap_amount'=>$x->cap_amount===null?null:(float)$x->cap_amount]))]); }
    public function createCashback(Request $request): JsonResponse { $m=$this->adminMembership($request); $d=$request->validate(['card_id'=>'nullable|string','merchant_name'=>'nullable|string|max:160','category'=>'nullable|string|max:120','cashback_rate'=>'required|numeric|min:0','cap_amount'=>'nullable|numeric|min:0','valid_from'=>'nullable|date','valid_to'=>'nullable|date','notes'=>'nullable|string']); DB::table('cashback_offers')->insert(['id'=>(string)Str::ulid(),'family_id'=>$m->family_id,'card_id'=>$d['card_id']??null,'merchant_name'=>$d['merchant_name']??null,'category'=>$d['category']??null,'cashback_rate'=>$d['cashback_rate'],'cap_amount'=>$d['cap_amount']??null,'valid_from'=>$d['valid_from']??null,'valid_to'=>$d['valid_to']??null,'notes'=>$d['notes']??null,'created_by'=>$m->user_id,'created_at'=>now(),'updated_at'=>now()]); return $this->cashback($request); }

    // ---- Receipts: v07 N-expenses flow ----
    public function receipts(Request $request): JsonResponse {
        $m=$this->viewMembership($request);
        $rows = DB::table('receipts')->where('family_id',$m->family_id)->whereNull('deleted_at')->orderByDesc('created_at')->get()->map(function($x){
            $arr = (array)$x;
            $arr['ai_result'] = $x->ai_result ? json_decode($x->ai_result, true) : null;
            // decode review_payload if exists
            if (isset($x->review_payload) && $x->review_payload) {
                $arr['review_payload'] = is_string($x->review_payload) ? json_decode($x->review_payload, true) : $x->review_payload;
            }
            // hide raw image_data for list (keep thumb only) — but return flag if exists
            $arr['has_image'] = !empty($x->image_data);
            // don't leak huge base64 in list unless needed — provide truncated
            if (isset($arr['image_data']) && strlen($arr['image_data']) > 200) {
                $arr['image_data_preview'] = substr($arr['image_data'], 0, 200).'...';
            }
            return $arr;
        });
        return response()->json(['data'=>$rows]);
    }

    public function receiptShow(Request $request, string $receipt): JsonResponse {
        $m=$this->viewMembership($request);
        $row = $this->ownedRow('receipts', $receipt, $m->family_id);
        $arr = (array)$row;
        $arr['ai_result'] = $row->ai_result ? json_decode($row->ai_result, true) : null;
        if (isset($row->review_payload) && $row->review_payload) {
            $arr['review_payload'] = is_string($row->review_payload) ? json_decode($row->review_payload, true) : $row->review_payload;
        }
        return response()->json(['data'=>$arr]);
    }

    public function uploadReceipt(Request $request): JsonResponse {
        $m=$this->adminMembership($request);
        $d=$request->validate(['file_name'=>'nullable|string|max:255','mime_type'=>'nullable|string|max:80','image_data'=>'required|string','merchant'=>'nullable|string|max:255','total'=>'nullable|numeric','occurred_on'=>'nullable|date','items'=>'nullable|array']);
        $id=(string)Str::ulid();
        // Prepare review_payload from initial items if provided (manual)
        $reviewPayload = null;
        if (!empty($d['items'])) {
            $reviewPayload = json_encode(['merchant'=>$d['merchant']??null,'total'=>$d['total']??null,'date'=>$d['occurred_on']??null,'items'=>$d['items']], JSON_UNESCAPED_UNICODE);
        }
        $insert = ['id'=>$id,'family_id'=>$m->family_id,'uploaded_by'=>$m->user_id,'file_name'=>$d['file_name']??null,'mime_type'=>$d['mime_type']??null,'image_data'=>$d['image_data'],'ocr_status'=>'PENDING','created_at'=>now(),'updated_at'=>now()];
        // Add review_payload/confirmed_at if columns exist (migration may not yet run) — try/catch
        try {
            if ($reviewPayload) $insert['review_payload'] = $reviewPayload;
        } catch(\Throwable $e){}
        DB::table('receipts')->insert($insert);
        $this->tryAnalyzeReceipt($id,$m->family_id);
        $row=DB::table('receipts')->where('id',$id)->first();
        $arr = (array)$row;
        $arr['ai_result']=$row->ai_result?json_decode($row->ai_result,true):null;
        if (isset($row->review_payload) && $row->review_payload) $arr['review_payload']=is_string($row->review_payload)?json_decode($row->review_payload,true):$row->review_payload;
        return response()->json(['data'=>$arr],201);
    }

    public function updateReceipt(Request $request, string $receipt): JsonResponse {
        $m=$this->adminMembership($request);
        $row = $this->ownedRow('receipts',$receipt,$m->family_id);
        // Prevent editing after confirmed
        $status = $row->ocr_status ?? '';
        if ($status === 'CONFIRMED') abort(409, 'Чек уже подтверждён, редактирование запрещено');
        $d=$request->validate([
            'merchant'=>'nullable|string|max:255',
            'total'=>'nullable|numeric|min:0',
            'date'=>'nullable|date',
            'currency'=>'nullable|string|max:10',
            'items'=>'nullable|array',
            'items.*.name'=>'required_with:items|string|max:255',
            'items.*.qty'=>'nullable|numeric|min:0',
            'items.*.price'=>'required_with:items|numeric|min:0',
            'items.*.category'=>'nullable|string|max:120',
            'items.*.category_id'=>'nullable|string',
        ]);
        $payload = [
            'merchant'=>$d['merchant']??null,
            'total'=>isset($d['total'])?(float)$d['total']:null,
            'date'=>$d['date']??null,
            'currency'=>$d['currency']??'RUB',
            'items'=> $d['items'] ?? null,
        ];
        // Try to update review_payload if column exists, else fallback to ai_result
        $updated = false;
        try {
            DB::table('receipts')->where('id',$receipt)->update(['review_payload'=>json_encode($payload,JSON_UNESCAPED_UNICODE),'updated_at'=>now()]);
            $updated = true;
        } catch(\Throwable $e){
            // Fallback: store in ai_result under review key
            $ai = $row->ai_result ? json_decode($row->ai_result,true) : [];
            $ai['review_payload'] = $payload;
            DB::table('receipts')->where('id',$receipt)->update(['ai_result'=>json_encode($ai,JSON_UNESCAPED_UNICODE),'updated_at'=>now()]);
            $updated = true;
        }
        $row = DB::table('receipts')->where('id',$receipt)->first();
        $arr=(array)$row;
        $arr['ai_result']=$row->ai_result?json_decode($row->ai_result,true):null;
        if (isset($row->review_payload) && $row->review_payload) $arr['review_payload']=is_string($row->review_payload)?json_decode($row->review_payload,true):$row->review_payload;
        // If fallback, extract from ai_result
        if (!isset($arr['review_payload']) && isset($arr['ai_result']['review_payload'])) $arr['review_payload']=$arr['ai_result']['review_payload'];
        return response()->json(['data'=>$arr]);
    }

    public function confirmReceipt(Request $request, string $receipt): JsonResponse {
        $m=$this->adminMembership($request);
        $row = $this->ownedRow('receipts',$receipt,$m->family_id);
        $status = $row->ocr_status ?? '';
        if ($status === 'CONFIRMED') {
            return response()->json(['message'=>'Чек уже подтверждён','data'=>(array)$row], 409);
        }
        $d=$request->validate([
            'merchant'=>'nullable|string|max:255',
            'total'=>'nullable|numeric|min:0',
            'date'=>'nullable|date',
            'currency'=>'nullable|string|max:10',
            'items'=>'required|array|min:1',
            'items.*.name'=>'required|string|max:255',
            'items.*.qty'=>'nullable|numeric|min:0',
            'items.*.price'=>'required|numeric|min:0',
            'items.*.category'=>'nullable|string|max:120',
            'items.*.category_id'=>'nullable|string',
            'items.*.amount'=>'nullable|numeric|min:0',
        ]);

        $date = $d['date'] ?? Carbon::now()->format('Y-m-d');
        // Idempotency: if already has expense_id and confirmed, abort
        if (!empty($row->expense_id)) {
            $exists = DB::table('finance_transactions')->where('id',$row->expense_id)->exists();
            if ($exists && $status==='CONFIRMED') abort(409, 'Чек уже подтверждён');
        }

        $createdIds = [];
        DB::transaction(function() use ($d, $date, $m, $receipt, &$createdIds, $row) {
            foreach ($d['items'] as $item) {
                $qty = isset($item['qty']) ? (float)$item['qty'] : 1;
                $price = (float)$item['price'];
                // Allow amount override, else qty*price
                $amount = isset($item['amount']) ? (float)$item['amount'] : round($qty * $price, 2);
                if ($amount <= 0) $amount = round($price,2);
                $catName = $item['category'] ?? 'Покупки';
                $catId = $this->resolveCategoryId($m->family_id, $catName, $item['category_id'] ?? null);
                $id = (string) Str::ulid();
                DB::table('finance_transactions')->insert([
                    'id'=>$id,
                    'family_id'=>$m->family_id,
                    'type'=>'EXPENSE',
                    'amount'=>$amount,
                    'category'=>$catName,
                    'category_id'=>$catId,
                    'description'=>mb_substr($item['name'],0,255),
                    'occurred_on'=>$date,
                    'created_by'=>$m->user_id,
                    'created_at'=>now(),
                    'updated_at'=>now(),
                    // receipt_id if column exists — try, ignore if not
                ]);
                // Try to set receipt_id if column exists
                try {
                    DB::table('finance_transactions')->where('id',$id)->update(['receipt_id'=>$receipt]);
                } catch(\Throwable $e){}
                $createdIds[] = $id;
            }
            // Update receipt as confirmed
            $update = ['ocr_status'=>'CONFIRMED','updated_at'=>now()];
            try { $update['confirmed_at']=now(); } catch(\Throwable $e){}
            // Store review_payload final
            $payload = ['merchant'=>$d['merchant']??null,'total'=>$d['total']??null,'date'=>$date,'currency'=>$d['currency']??'RUB','items'=>$d['items']];
            try { $update['review_payload']=json_encode($payload,JSON_UNESCAPED_UNICODE); } catch(\Throwable $e){}
            // Do NOT set expense_id (FK to expenses table) — link via finance_transactions.receipt_id instead
            // Clear heavy image_data after 30 days? For now keep but optionally truncate preview — we keep it, but frontend should not refetch huge
            DB::table('receipts')->where('id',$receipt)->update($update);
        });

        $transactions = DB::table('finance_transactions')->whereIn('id',$createdIds)->get()->map(fn($x)=>array_merge((array)$x,['amount'=>(float)$x->amount]));
        $row = DB::table('receipts')->where('id',$receipt)->first();
        $arr=(array)$row;
        $arr['ai_result']=$row->ai_result?json_decode($row->ai_result,true):null;
        if (isset($row->review_payload)) $arr['review_payload']=is_string($row->review_payload)?json_decode($row->review_payload,true):$row->review_payload;

        return response()->json(['data'=>[
            'receipt'=>$arr,
            'transactions'=>$transactions,
            'created_count'=>count($createdIds),
            'total_amount'=>round($transactions->sum('amount'),2),
        ]], 201);
    }

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
        $result=null;
        $parsedItems = null;
        if(env('OPENAI_API_KEY')){
            try{
                $resp=Http::withToken(env('OPENAI_API_KEY'))->timeout(45)->post('https://api.openai.com/v1/responses',['model'=>env('OPENAI_MODEL','gpt-5.6-luna'),'input'=>[['role'=>'user','content'=>[['type'=>'input_text','text'=>'Распознай чек. Верни JSON только с полями merchant,total,date,currency,items{name,qty,price,category}. Не придумывай значения. Если поле неизвестно, null.'],['type'=>'input_image','image_url'=>$image]]]]]);
                if($resp->successful()){
                    $json=$resp->json();
                    $result=['raw'=>$json];
                    // Try to extract structured JSON from output text if model returned JSON
                    $textOut = $json['output'][0]['content'][0]['text'] ?? null;
                    if ($textOut) {
                        // Try to find JSON in text
                        if (preg_match('/\{.*\}/s', $textOut, $m)) {
                            $decoded = json_decode($m[0], true);
                            if ($decoded) {
                                $result['parsed'] = $decoded;
                                $parsedItems = $decoded['items'] ?? null;
                            }
                        }
                    }
                }
            }catch(\Throwable $e){report($e);}
        }
        // Build initial review_payload from parsed result if available
        $payload = null;
        if ($parsedItems || $result) {
            $payload = $result['parsed'] ?? ['merchant'=>null,'total'=>null,'date'=>null,'currency'=>'RUB','items'=>$parsedItems];
        }
        $update = ['ocr_status'=>$ocrText||$result?'COMPLETED':'NOT_CONFIGURED','ocr_text'=>$ocrText,'ai_result'=>$result?json_encode($result,JSON_UNESCAPED_UNICODE):null,'updated_at'=>now()];
        if ($payload) {
            try { $update['review_payload']=json_encode($payload,JSON_UNESCAPED_UNICODE); } catch(\Throwable $e){}
        }
        DB::table('receipts')->where('id',$id)->update($update);
    }

    private function ownedRow(string $table,string $id,string $familyId): object { $row=DB::table($table)->where('id',$id)->where('family_id',$familyId)->first(); abort_unless($row,404); return $row; }
}
