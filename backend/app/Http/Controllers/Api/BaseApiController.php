<?php
namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use App\Models\FamilyMember;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;
abstract class BaseApiController extends Controller {
 protected function membership(Request $request, ?string $familyId=null): FamilyMember { $q=$request->user()->familyMembers()->where('status','ACTIVE'); if($familyId)$q->where('family_id',$familyId); $m=$q->first(); if(!$m) throw new HttpException(403,'Active family membership required.'); return $m; }
 protected function assertFamilyMember(Request $request,string $familyId): FamilyMember { return $this->membership($request,$familyId); }
 protected function assertAdmin(FamilyMember $m): void { abort_unless($m->role==='ADMIN',403,'Administrator role required.'); }
}
