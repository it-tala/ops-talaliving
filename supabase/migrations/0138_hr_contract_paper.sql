-- 0138 — the signed contract can be attached after the contract is registered.
--
-- Found by the HR walk (F154). `activate_contract` refuses `paper_required`
-- until the signed paper is linked, and the only road to link it was an
-- argument of `register_contract` — which `NewContract.tsx` never sends,
-- because the form has no file field. So every contract registered from the
-- screen stayed a draft for ever: the rule was right and the door to satisfy
-- it did not exist.
--
-- The paper usually arrives *after* the contract is typed in — HR registers
-- the terms, prints, the person signs, the scan comes back. So the fix is a
-- second road, on the contract's own page, rather than a file field on the
-- register form that people would leave empty and then be stuck anyway.
--
-- Only a **draft** takes paper this way. An active contract's paper is the
-- thing that was in force; swapping it afterwards is a new contract (which
-- supersedes this one), not an edit.

create or replace function ops_hr.attach_contract_paper(
  p_contract_no   text,
  p_attachment_id uuid,
  p_sha256        text default null,
  p_key           text default null)
returns jsonb
language plpgsql security definer set search_path = ops_hr, ops_core, pg_temp as $$
declare
  v_replayed jsonb; v_c ops_hr.employment_contracts; v_emp_no text;
  v_linked jsonb; v_link uuid; v_res jsonb;
begin
  v_replayed := ops_core.idem_replay('hr','attach_contract_paper', p_key);
  if v_replayed is not null then return v_replayed; end if;

  if not ops_core.has_permission('hrd.update') then
    return ops_core.refused('hr','contract', p_contract_no,'attach_paper',
      'not_permitted','Melampirkan berkas kontrak butuh akses HRD.');
  end if;

  select c.* into v_c from ops_hr.employment_contracts c where c.contract_no = p_contract_no;
  if not found then
    return ops_core.not_found('hr','contract', p_contract_no,'attach_paper',
      format('Tidak ada kontrak %s.', p_contract_no));
  end if;
  if v_c.status <> 'draft' then
    return ops_core.conflict('hr','contract', p_contract_no,'attach_paper',
      'not_a_draft',
      format('%s sudah %s. Kertas kontrak yang sudah berlaku tidak diganti — buat kontrak baru.',
             p_contract_no, v_c.status));
  end if;
  if p_attachment_id is null then
    return ops_core.invalid('hr','contract', p_contract_no,'attach_paper',
      'attachment_required','Pilih berkas kontrak yang sudah ditandatangani.',
      jsonb_build_object('field','attachment_id'));
  end if;

  select e.employee_no into v_emp_no from ops_hr.employees e where e.id = v_c.employee_id;

  -- The same road `register_contract` takes (ADR-010): the document seam
  -- owns the link, this seam only remembers which one is the contract.
  v_linked := ops_core.attach_link(p_attachment_id,'employee', v_emp_no,'kontrak_kerja');
  if not ops_core.said_ok(v_linked) and v_linked ->> 'outcome' <> 'duplicate' then
    return v_linked;
  end if;
  select id into v_link from ops_core.attachment_links
   where attachment_id = p_attachment_id and entity = 'employee'
     and entity_no = v_emp_no and kind = 'kontrak_kerja' and unlinked_at is null;

  update ops_hr.employment_contracts
     set link_id = v_link,
         sha256  = coalesce(nullif(btrim(coalesce(p_sha256,'')), ''), sha256)
   where contract_no = p_contract_no;

  v_res := ops_core.ok('hr','contract', p_contract_no,'attach_paper',
    jsonb_build_object('contract_no', p_contract_no, 'employee_no', v_emp_no,
                       'attachment_id', p_attachment_id, 'replaced', v_c.link_id is not null));
  return ops_core.idem_remember('hr','attach_contract_paper', p_key, v_res);
end $$;

-- A new function is executable by PUBLIC, which `anon` inherits (0125).
revoke execute on function ops_hr.attach_contract_paper(text, uuid, text, text) from public;
grant execute on function ops_hr.attach_contract_paper(text, uuid, text, text) to authenticated;

comment on function ops_hr.attach_contract_paper is
  'Links the signed paper to a draft contract, so it can be put in force. The road the '
  'register form never offered (F154). Draft only: an active contract''s paper is not swapped.';
