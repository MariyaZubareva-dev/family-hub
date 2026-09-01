<?php
namespace App\Http\Controllers\Api;
use App\Models\FamilyList;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
class ListController extends BaseApiController {
 public function index(Request $r):JsonResponse{$m=$this->membership($r);return response()->json(['data'=>FamilyList::where('family_id',$m->family_id)->with('items')->orderBy('name')->get()]);}
 public function store(Request $r):JsonResponse{$m=$this->membership($r);$this->assertAdmin($m);$d=$r->validate(['name'=>['required','string','max:120'],'type'=>['nullable','string','max:32']]);$x=FamilyList::create(['family_id'=>$m->family_id,'created_by'=>$m->user_id,'name'=>$d['name'],'type'=>$d['type']??'CUSTOM']);return response()->json(['data'=>$x->load('items')],201);}
 public function update(Request $r,FamilyList $list):JsonResponse{$m=$this->membership($r,$list->family_id);$this->assertAdmin($m);$d=$r->validate(['name'=>['required','string','max:120']]);$list->update($d);return response()->json(['data'=>$list->fresh()->load('items')]);}
 public function destroy(Request $r,FamilyList $list):JsonResponse{$m=$this->membership($r,$list->family_id);$this->assertAdmin($m);$list->delete();return response()->json([],204);}
}
