<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
class Receipt extends Model { use HasUlids; protected $guarded=[]; public $incrementing=false; protected $keyType='string'; protected $casts=['ai_result'=>'array']; }
