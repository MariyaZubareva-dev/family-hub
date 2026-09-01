<?php
return ['default'=>env('QUEUE_CONNECTION','sync'),'connections'=>['sync'=>['driver'=>'sync']],'batching'=>['database'=>env('DB_CONNECTION','pgsql'),'table'=>'job_batches'],'failed'=>['driver'=>'database-uuids','connection'=>env('DB_CONNECTION','pgsql'),'table'=>'failed_jobs']];
