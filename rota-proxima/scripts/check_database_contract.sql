-- Read-only preflight: all rows must be installed, callable by authenticated,
-- and protected from anonymous execution before publishing route controls.
with required(signature) as (values
 ('public.reorder_pending_stops(bigint,bigint[],jsonb)'),
 ('public.set_pev_drum_status(bigint,boolean)'),
 ('public.prepare_evidence_sync(bigint,jsonb)'),
 ('public.claim_evidence_sync(integer,bigint)'),
 ('public.fail_evidence_sync(bigint,text)'),
 ('public.reset_failed_evidence_sync()')
), resolved as (
 select signature,to_regprocedure(signature) as procedure from required
)
select signature,procedure is not null as installed,
 coalesce(has_function_privilege('authenticated',procedure,'execute'),false) as authenticated_can_execute,
 coalesce(has_function_privilege('anon',procedure,'execute'),false) as anon_can_execute
from resolved order by signature;
