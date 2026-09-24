import type { EmployeeIdentity } from "@/services/hr/contracts";

/** Data diri untuk WLKP, sengaja setengah terisi.
 *
 *  The point of this seed is the **gaps**. WLKP cannot be filed until all six
 *  fields are answered for everybody, and a fixture where everybody is complete
 *  would show a recap with no `belum diisi` anywhere — which is not what the
 *  screen looks like on the day somebody first opens it, and not what it has to
 *  be good at.
 *
 *  So: five people filled, three left entirely empty, and one filled except for
 *  a single field. Between them they exercise every bucket the recap prints —
 *  both sexes, four education levels, a WNA, somebody with a disability,
 *  somebody asked who answered no, and somebody nobody has asked.
 *
 *  `disabled: false` and `disabled: null` are both here on purpose and they are
 *  not the same fact: the first is an answer, the second is a question nobody
 *  put. A seed that used `false` for everybody would make the recap's
 *  `tidak_diketahui` bucket permanently empty and the rule it exists for
 *  untestable.
 */
const at = "2026-09-20T09:00:00+08:00";
const by = "usr_wulan";

const id = (
  employee_id: string,
  born_on: string,
  sex: EmployeeIdentity["sex"],
  education: EmployeeIdentity["education"],
  marital_status: EmployeeIdentity["marital_status"],
  extra: Partial<EmployeeIdentity> = {},
): EmployeeIdentity => ({
  employee_id, born_on, sex, education,
  citizenship: "WNI", nationality: null,
  disabled: false, disability_note: null,
  marital_status,
  updated_by: by, updated_at: at,
  ...extra,
});

export const EMPLOYEE_IDENTITIES: EmployeeIdentity[] = [
  id("emp_02", "1990-05-04", "P", "S1", "KAWIN"),
  id("emp_03", "1996-11-12", "P", "D3", "BELUM_KAWIN"),
  id("emp_04", "1988-02-29", "L", "S1", "KAWIN"),
  /* Karjo, bengkel: SMP, dan menjawab **ya** pada disabilitas. Satu orang yang
     dihitung di kolom itu adalah bedanya antara kolom yang teruji dan kolom
     yang selalu nol. */
  id("emp_w009", "1985-07-18", "L", "SMP", "KAWIN", {
    disabled: true,
    disability_note: "Pendengaran sebelah kanan berkurang; sudah disesuaikan penempatannya.",
  }),
  /* Seorang WNA, karena WLKP menghitung tenaga kerja asing **per negara** dan
     daftar negara yang selalu kosong tidak membuktikan apa pun. */
  id("emp_05", "1993-04-09", "L", "D4", "BELUM_KAWIN", {
    citizenship: "WNA", nationality: "Timor-Leste",
  }),
  /* Dan satu yang hampir lengkap: semua terisi kecuali disabilitas, yang belum
     pernah ditanyakan. Inilah baris yang membuat layarnya berguna — ia tahu
     persis satu pertanyaan yang tersisa untuk satu orang. */
  {
    employee_id: "emp_01", born_on: "1999-01-22", sex: "P", education: "SMA",
    citizenship: "WNI", nationality: null,
    disabled: null, disability_note: null,
    marital_status: "BELUM_KAWIN",
    updated_by: by, updated_at: at,
  },
];
