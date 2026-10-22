<?php
namespace App\Models;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
class CreditPayment extends Model {
    use HasUlids;
    protected $guarded=[];
    protected $keyType='string';
    public $incrementing=false;
    protected $casts=['amount'=>'decimal:2','paid_on'=>'date','scheduled_on'=>'date'];
    protected function serializeDate(DateTimeInterface $date): string {return $date->format('Y-m-d');}
    public function credit(): BelongsTo {return $this->belongsTo(Credit::class);}
}
