<?php
namespace App\Http\Controllers\Api;
use App\Models\Reminder;
use App\Models\FamilyMember;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
class ReminderController extends BaseApiController {
 use Concerns\HasCalendarResponsibles;
 public function index(Request $r):JsonResponse{$m=$this->membership($r);return response()->json(['data'=>Reminder::where('family_id',$m->family_id)->with(['creator','responsibleMember.user'])->orderBy('scheduled_at')->get()]);}
 public function store(Request $r):JsonResponse{$m=$this->membership($r);$d=$r->validate(['title'=>['required','string','max:255'],'description'=>['nullable','string'],'scheduled_at'=>['required','date'],'timezone'=>['nullable','timezone'],...$this->responsibleRules(true),'recurrence_rule'=>['nullable','string','max:255']]);$ids=$this->responsibleIds($m->family_id,$d);$d['responsible_member_ids']=$ids;$d['responsible_member_id']=$ids[0];$x=Reminder::create([...$d,'family_id'=>$m->family_id,'created_by'=>$m->user_id]);return response()->json(['data'=>$x->load(['creator','responsibleMember.user'])],201);}
 public function update(Request $r,Reminder $reminder):JsonResponse{$m=$this->membership($r,$reminder->family_id);abort_unless($m->role==='ADMIN'||$reminder->created_by===$m->user_id,403);$d=$r->validate(['title'=>['sometimes','required','string','max:255'],'description'=>['nullable','string'],'scheduled_at'=>['sometimes','required','date'],'timezone'=>['nullable','timezone'],...$this->responsibleRules(false),'status'=>['sometimes','in:SCHEDULED,COMPLETED,CANCELLED'],'recurrence_rule'=>['nullable','string','max:255']]);if(isset($d['responsible_member_id'])||array_key_exists('responsible_member_ids',$d)){$ids=$this->responsibleIds($m->family_id,$d);$d['responsible_member_ids']=$ids;$d['responsible_member_id']=$ids[0];}$reminder->update($d);return response()->json(['data'=>$reminder->fresh()->load(['creator','responsibleMember.user'])]);}
 public function destroy(Request $r,Reminder $reminder):JsonResponse{$m=$this->membership($r,$reminder->family_id);abort_unless($m->role==='ADMIN'||$reminder->created_by===$m->user_id,403);$reminder->delete();return response()->json([],204);}
}
