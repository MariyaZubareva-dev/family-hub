<?php
namespace App\Http\Controllers\Api;
use App\Models\Note;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
class NoteController extends BaseApiController {
 public function index(Request $r):JsonResponse{$m=$this->membership($r);return response()->json(['data'=>Note::where('family_id',$m->family_id)->where('created_by',$m->user_id)->orderByDesc('updated_at')->get()]);}
 public function store(Request $r):JsonResponse{$m=$this->membership($r);$d=$r->validate(['title'=>['required','string','max:255'],'body'=>['required','string']]);$x=Note::create([...$d,'family_id'=>$m->family_id,'created_by'=>$m->user_id]);return response()->json(['data'=>$x],201);}
 public function update(Request $r,Note $note):JsonResponse{$m=$this->membership($r,$note->family_id);abort_unless($note->created_by===$m->user_id,403);$d=$r->validate(['title'=>['sometimes','required','string','max:255'],'body'=>['sometimes','required','string']]);$note->update($d);return response()->json(['data'=>$note->fresh()]);}
 public function destroy(Request $r,Note $note):JsonResponse{$m=$this->membership($r,$note->family_id);abort_unless($note->created_by===$m->user_id,403);$note->delete();return response()->json([],204);}
}
