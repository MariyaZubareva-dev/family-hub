<?php
namespace App\Http\Controllers\Api;
use App\Models\FamilyList;
use App\Models\ListItem;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
class ListItemController extends BaseApiController {
 public function store(Request $r,FamilyList $list):JsonResponse{$m=$this->membership($r,$list->family_id);$d=$r->validate(['title'=>['required','string','max:255']]);$x=$list->items()->create(['title'=>$d['title'],'created_by'=>$m->user_id,'position'=>(int)$list->items()->max('position')+1]);return response()->json(['data'=>$x],201);}
 public function update(Request $r,FamilyList $list,ListItem $item):JsonResponse{$m=$this->membership($r,$list->family_id);abort_if($item->list_id!==$list->id,404);$d=$r->validate(['title'=>['sometimes','required','string','max:255'],'is_completed'=>['sometimes','boolean'],'position'=>['sometimes','integer','min:0']]);if(array_key_exists('is_completed',$d)){if($d['is_completed']){$d['completed_by']=$m->user_id;$d['completed_at']=now();}else{$d['completed_by']=null;$d['completed_at']=null;}}$item->update($d);return response()->json(['data'=>$item->fresh()]);}
 public function destroy(Request $r,FamilyList $list,ListItem $item):JsonResponse{$m=$this->membership($r,$list->family_id);abort_unless($m->role==='ADMIN'||$item->created_by===$m->user_id,403);abort_if($item->list_id!==$list->id,404);$item->delete();return response()->json([],204);}
}
