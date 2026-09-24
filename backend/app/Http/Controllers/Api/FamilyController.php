<?php

namespace App\Http\Controllers\Api;

use App\Models\Family;
use App\Models\FamilyInvitation;
use App\Models\FamilyMember;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class FamilyController extends BaseApiController
{
    public function show(Request $request): JsonResponse
    {
        $m=$this->membership($request);
        $family=$m->family()->with('members.user')->firstOrFail();
        return response()->json(['data'=>$this->payload($family,$m)]);
    }

    public function update(Request $request): JsonResponse
    {
        $m=$this->membership($request); $this->assertAdmin($m);
        $data=$request->validate(['name'=>['required','string','max:120']]);
        $m->family->update($data);
        return response()->json(['data'=>$this->payload($m->family->fresh()->load('members.user'),$m)]);
    }

    public function invitations(Request $request): JsonResponse
    {
        $user=$request->user();
        $membership=$user->familyMembers()->where('status','ACTIVE')->first();
        $query=FamilyInvitation::where('status',FamilyInvitation::PENDING)->where(function($q)use($user){
            $q->where('telegram_user_id',$user->telegram_user_id);
            if($user->username){ $q->orWhereRaw('LOWER(username)=?', [mb_strtolower(ltrim($user->username,'@'))]); }
        });
        if($membership && $membership->role==='ADMIN'){
            $query=FamilyInvitation::where('family_id',$membership->family_id)->where('status',FamilyInvitation::PENDING);
        }
        $items=$query->with(['inviter','family'])->latest()->get();
        return response()->json(['data'=>$items]);
    }

    public function invite(Request $request): JsonResponse
    {
        $m=$this->membership($request); $this->assertAdmin($m);
        $d=$request->validate([
            'telegram_user_id'=>['nullable','integer','min:1'],
            'username'=>['nullable','string','max:255'],
            'first_name'=>['nullable','string','max:255'],
        ]);
        abort_unless(!empty($d['telegram_user_id']) || !empty($d['username']),422,'Укажите Telegram ID или логин.');
        $telegramId=$d['telegram_user_id']??null;
        $username=isset($d['username']) && $d['username'] ? ltrim(trim($d['username']),'@') : null;
        if($username){
            $known=User::whereRaw('LOWER(username)=?', [mb_strtolower($username)])->first();
            if($known) $telegramId=$known->telegram_user_id;
        }
        if($telegramId){
            $hasActiveMember=FamilyMember::query()->where('family_id',$m->family_id)->whereHas('user',fn($q)=>$q->where('telegram_user_id',$telegramId))->where('status','ACTIVE')->exists();
            abort_if($hasActiveMember,409,'Пользователь уже состоит в семье.');
        }
        $pending=FamilyInvitation::query()->where('family_id',$m->family_id)->where('status',FamilyInvitation::PENDING)->when($telegramId,fn($q)=>$q->where('telegram_user_id',$telegramId))->when(!$telegramId&&$username,fn($q)=>$q->whereRaw('LOWER(username)=?',[mb_strtolower($username)]))->first();
        abort_if($pending,409,'Такое приглашение уже отправлено.');
        $inv=FamilyInvitation::create(['family_id'=>$m->family_id,'telegram_user_id'=>$telegramId,'username'=>$username,'first_name'=>$d['first_name']??null,'status'=>FamilyInvitation::PENDING,'invited_by'=>$m->user_id,'expires_at'=>now()->addDays(14)]);
        return response()->json(['data'=>$inv->load(['inviter','family'])],201);
    }

    public function acceptInvitation(Request $request, FamilyInvitation $invitation): JsonResponse
    {
        $username=$request->user()->username;
        $validId=$invitation->telegram_user_id && (int)$invitation->telegram_user_id===(int)$request->user()->telegram_user_id;
        $validUsername=$username && $invitation->username && mb_strtolower(ltrim($username,'@'))===mb_strtolower(ltrim($invitation->username,'@'));
        abort_unless($validId||$validUsername,403);
        abort_unless($invitation->status===FamilyInvitation::PENDING,409,'Приглашение недействительно.');
        abort_if($invitation->expires_at && $invitation->expires_at->isPast(),409,'Срок приглашения истёк.');
        abort_if($request->user()->familyMembers()->where('status','ACTIVE')->exists(),409,'Пользователь уже состоит в семье.');
        $member=DB::transaction(function()use($invitation,$request){
            $locked=FamilyInvitation::whereKey($invitation->id)->lockForUpdate()->firstOrFail();
            abort_unless($locked->status===FamilyInvitation::PENDING,409,'Приглашение недействительно.');
            if(!$locked->telegram_user_id){$locked->telegram_user_id=$request->user()->telegram_user_id; $locked->save();}
            $member=FamilyMember::firstOrCreate(['family_id'=>$locked->family_id,'user_id'=>$request->user()->id],['role'=>'USER','status'=>'ACTIVE','invited_by'=>$locked->invited_by,'joined_at'=>now()]);
            $member->update(['status'=>'ACTIVE','role'=>'USER','invited_by'=>$locked->invited_by,'joined_at'=>$member->joined_at??now()]);
            $locked->update(['status'=>FamilyInvitation::ACCEPTED,'accepted_at'=>now()]);
            return $member;
        });
        return response()->json(['data'=>$member->load('user')]);
    }

    public function updateMember(Request $request, FamilyMember $member): JsonResponse { $m=$this->membership($request,$member->family_id); $this->assertAdmin($m); abort_if($member->family_id!==$m->family_id,404); $d=$request->validate(['role'=>['required','in:ADMIN,USER'],'status'=>['sometimes','in:ACTIVE,INACTIVE']]); $member=DB::transaction(function()use($member,$d){ $member=FamilyMember::whereKey($member->id)->lockForUpdate()->firstOrFail(); $removesAdmin=$member->role==='ADMIN' && (($d['role']??'ADMIN')!=='ADMIN'||($d['status']??'ACTIVE')!=='ACTIVE'); if($removesAdmin)$this->assertNotLastAdmin($member->family_id); $member->update($d); return $member; }); return response()->json(['data'=>$member->fresh()->load('user')]); }
    public function removeMember(Request $request, FamilyMember $member): JsonResponse { $m=$this->membership($request,$member->family_id); $this->assertAdmin($m); abort_if($member->family_id!==$m->family_id,404); DB::transaction(function()use($member){ $member=FamilyMember::whereKey($member->id)->lockForUpdate()->firstOrFail(); if($member->role==='ADMIN')$this->assertNotLastAdmin($member->family_id); $member->update(['status'=>'INACTIVE']); }); return response()->json([],204); }
    public function leave(Request $request): JsonResponse { $member=$this->membership($request); DB::transaction(function()use($member){ $member=FamilyMember::whereKey($member->id)->lockForUpdate()->firstOrFail(); if($member->role==='ADMIN')$this->assertNotLastAdmin($member->family_id); $member->update(['status'=>'INACTIVE']); }); return response()->json([],204); }
    public function create(Request $request): JsonResponse { abort_if($request->user()->familyMembers()->where('status','ACTIVE')->exists(),409,'User already belongs to an active family.'); $d=$request->validate(['name'=>['required','string','max:120']]); $family=Family::create(['name'=>$d['name'],'status'=>'ACTIVE','created_by'=>$request->user()->id]); $member=FamilyMember::create(['family_id'=>$family->id,'user_id'=>$request->user()->id,'role'=>'ADMIN','status'=>'ACTIVE','joined_at'=>now()]); return response()->json(['data'=>$this->payload($family->load('members.user'),$member)],201); }
    private function assertNotLastAdmin(string $familyId): void { $admins=FamilyMember::where('family_id',$familyId)->where('status','ACTIVE')->where('role','ADMIN')->lockForUpdate()->count(); abort_if($admins<=1,422,'The last administrator cannot be removed or demoted.'); }
    private function payload(Family $family,FamilyMember $m): array { return ['id'=>$family->id,'name'=>$family->name,'status'=>$family->status,'my_role'=>$m->role,'members'=>$family->members->where('status','ACTIVE')->values()->map(fn($x)=>['id'=>$x->id,'role'=>$x->role,'status'=>$x->status,'joined_at'=>$x->joined_at,'user'=>$x->user])]; }
}
