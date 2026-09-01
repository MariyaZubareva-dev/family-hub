<?php
namespace App\Http\Controllers\Api;
use App\Models\Idea;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
class IdeaController extends BaseApiController {
 public function index(Request $r):JsonResponse{$m=$this->membership($r);return response()->json(['data'=>Idea::where('family_id',$m->family_id)->with('author')->orderByDesc('created_at')->get()]);}
 public function store(Request $r):JsonResponse{$m=$this->membership($r);$d=$r->validate(['title'=>['required','string','max:255'],'description'=>['nullable','string']]);$x=Idea::create([...$d,'family_id'=>$m->family_id,'created_by'=>$m->user_id,'status'=>'OPEN']);return response()->json(['data'=>$x->load('author')],201);}
 public function update(Request $r,Idea $idea):JsonResponse{$m=$this->membership($r,$idea->family_id);$d=$r->validate(['title'=>['sometimes','required','string','max:255'],'description'=>['nullable','string'],'status'=>['sometimes','in:OPEN,DONE,ARCHIVED']]);abort_unless($m->role==='ADMIN'||$idea->created_by===$m->user_id,403);$idea->update($d);return response()->json(['data'=>$idea->fresh()->load('author')]);}
 public function destroy(Request $r,Idea $idea):JsonResponse{$m=$this->membership($r,$idea->family_id);abort_unless($m->role==='ADMIN'||$idea->created_by===$m->user_id,403);$idea->delete();return response()->json([],204);}
}
