<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class StoreListItem extends Model
{
    use HasUlids,SoftDeletes;
    protected $guarded=[];
    protected $keyType='string';
    public $incrementing=false;
    protected $casts=['is_completed'=>'boolean','completed_at'=>'datetime','recurring_due_date'=>'date:Y-m-d','previous_purchased_on'=>'date:Y-m-d','purchased_on'=>'date:Y-m-d','rescheduled_due_date'=>'date:Y-m-d','schedule_revision'=>'integer'];
    protected $hidden=['previous_purchased_on','purchased_on','rescheduled_due_date','schedule_revision'];
}
