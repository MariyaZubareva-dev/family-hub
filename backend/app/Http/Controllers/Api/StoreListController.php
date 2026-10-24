<?php

namespace App\Http\Controllers\Api;

use App\Models\StoreListItem;
use App\Services\StoreListService;
use Illuminate\Http\{Request,JsonResponse};

class StoreListController extends BaseApiController
{
    public function index(Request $request, StoreListService $service): JsonResponse
    {
        $m=$this->membership($request); $service->sync($m->family_id);
        return response()->json(['data'=>StoreListItem::where('family_id',$m->family_id)->orderBy('is_completed')->orderByDesc('created_at')->orderByDesc('id')->get()]);
    }
    public function store(Request $request): JsonResponse
    {
        $m=$this->membership($request); $data=$this->validateItem($request,true);
        return response()->json(['data'=>StoreListItem::create([...$data,'family_id'=>$m->family_id,'created_by'=>$m->user_id])->fresh()],201);
    }
    public function update(Request $request, string $storeItem, StoreListService $service): JsonResponse
    {
        $m=$this->membership($request);
        $item=StoreListItem::where('family_id',$m->family_id)->findOrFail($storeItem);
        $data=$this->validateItem($request,false);
        return response()->json(['data'=>$service->update($item,$data,$m->user_id)]);
    }
    public function destroy(Request $request, string $storeItem): JsonResponse
    {
        $m=$this->membership($request);
        StoreListItem::where('family_id',$m->family_id)->findOrFail($storeItem)->delete();
        return response()->json([],204);
    }
    private function validateItem(Request $request, bool $creating): array
    {
        if(is_string($request->input('name')))$request->merge(['name'=>trim($request->input('name'))]);
        return $request->validate(['name'=>[$creating?'required':'sometimes','required','string','max:255'],
            'quantity'=>['nullable','string','max:80'],'notes'=>['nullable','string','max:500'],
            'is_completed'=>[$creating?'prohibited':'sometimes','boolean']],['name.required'=>'Введите название товара.']);
    }
}
