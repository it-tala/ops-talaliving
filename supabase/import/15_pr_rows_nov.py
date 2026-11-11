# NOVEMBER  PR RECAP, rows 7–32, read 2026-11-11. Rows 7–21 are paid (row 21
# paid with the EJO box still unticked); rows 22–32 are neither approved nor
# paid and land WAITING FOR APPROVAL. Same shape as 13_pr_rows.py, plus the
# 14th field `approved`.
SOURCE = '15_pr_rows_nov.py'
ROWS = [
 ('NOV7','2026-11-02',None,None,'EJO','CREDIT CARD MANDIRI','DATELINE TGL 4 NOV 2026',None,1,'MONTH',1535430,1535430,1535430),
 ('NOV8','2026-11-02',None,'ACCOUNTING','EJO','CREDIT CARD BNI','DATELINE TGL 9 NOV 2026',None,1,'MONTH',502500,502500,502500),
 ('NOV9','2026-11-03',None,'PROD',None,'SAWMILL JATI',None,None,1,None,865000,865000,865000),
 ('NOV10','2026-11-04','DEWI','DEWI','PAYROLL','MONTHLY PAYROLL - OCTOBER 2026',None,None,1,'MONTH',35021061,35021061,35021061),
 ('NOV11','2026-11-04',None,'DEWI','SAMPLE','JASA PASANG VENNER MINDI',None,None,5,'LEMBAR',137250,686250,669780),
 ('NOV12','2026-11-04',None,None,'EJO','DRIVER - FENDI','BIKE / SEPEDA WITH EJO 2x (Saturday and Wednesday)',None,2,None,70000,140000,140000),
 ('NOV13','2026-11-05','DEWI','DEWI','PAYROLL','DAILY PAYROLL - WEEK 1 NOV (30- 05 NOV 2026)',None,None,1,'WEEK',3988960,3988960,3988960),
 ('NOV14','2026-11-05',None,'DEWI',None,'SEWA GRAND MAX ANDI','89 km × Rp 2.500 (the sheet unit says WEEK)',None,89,None,2500,222500,222500),
 ('NOV15','2026-11-05',None,'RIAN','CARDS','TOP UP MONTHLY JENIUS CARDS',None,None,1,'MONTH',14757826,14757826,14757826),
 ('NOV16','2026-11-05',None,'EJO','SARIPAN','BELANJA SARIPAN - BALANCE 184.500',None,None,1,'WEEK',500000,500000,500000),
 ('NOV17','2026-11-05',None,'PROD','SAMPLE','THINER NC SUPER - SURYA BANGKIT',None,None,20,None,21000,420000,420000),
 ('NOV18','2026-11-05',None,'PROD','SAMPLE','GELAS CUP',None,None,1,None,11000,11000,11000),
 ('NOV19','2026-11-05',None,None,'INSENTIVE','INSENTIVE TO RIAN, AZKIA, DANIS, DEWI, RIAN, RIZKY',None,None,1,None,11000000,11000000,11000000),
 ('NOV20','2026-11-08',None,'EJO','INTERNET','BIZNET EJO',None,None,1,None,476750,476750,476750),
 ('NOV21','2026-11-09',None,None,'SAMPLE','BRASS HOT MELT - TOKOPEDIA','paid 9 Nov with the EJO APPROVAL box unticked; approved = paid',None,1,None,37000,37000,37000),
 ('NOV22','2026-11-09',None,None,None,'KARTU HALO EJO','DEADLINE 15 NOV',None,1,None,471750,471750,0,False),
 ('NOV23','2026-11-09',None,'DEWI','PESANGON','PESANGON - MUSLIKIN 30%',None,None,1,None,4990175,4990175,0,False),
 ('NOV24','2026-11-09',None,None,'INTERNET','INDIHOME TALAHOME','DEADLINE 15 NOV',None,1,None,776670,776670,0,False),
 ('NOV25','2026-11-09',None,None,'WAREHOUSE','KARTU HALO OFFICE','DEADLINE 15 NOV',None,1,None,125488,125488,0,False),
 ('NOV26','2026-11-09',None,None,'BPJS','BPJS KESEHATAN','DEADLINE 12 NOV',None,1,None,551300,551300,0,False),
 ('NOV27','2026-11-09',None,None,'TAX','TAX CONSULTAN','SUBADRIYAH',None,1,None,2000000,2000000,0,False),
 ('NOV28','2026-11-10',None,'EJO','SARIPAN','BELANJA SARIPAN - BALANCE 65500',None,None,1,None,500000,500000,0,False),
 ('NOV29','2026-11-11',None,'DEWI','PESANGON','PESANGON - IRWAN 30%',None,None,1,None,4660802,4660802,0,False),
 ('NOV30','2026-11-12',None,'EJO','EJO','DRIVER - FENDI','3 HOUR X 2 (SATURDAY AND WEDNESDAY)',None,2,None,100000,200000,0,False),
 ('NOV31','2026-11-13',None,'EJO','SARIPAN','AGUS GARDENER','1 WEEK WORK',None,1,None,200000,200000,0,False),
 ('NOV32','2026-10-05',None,None,'SARIPAN','LISTRIK SARIPAN','BY SHOPEE — dated 05/10 on the sheet like OKT15, which is paid; probably this month''s token with the old date',None,1,None,500000,500000,0,False),
]
WEB = {}
ALLOC = [
 ('NOV7', 'trx-26-11-11_114', 1535430, 'credit card Mandiri'),
 ('NOV8', 'trx-26-11-11_111', 502500, 'credit card BNI'),
 ('NOV9', 'trx-26-11-04_009', 865000, 'sawmill jati, Hafiz Mandiri'),
 ('NOV10', 'trx-26-11-11_121', 9000000, 'payroll October: EJO, Cintya, Dewi and part of the BNI batch. The four 5-Nov transfers (Rp 46.020.937) pay payroll October and the insentive together, Rp 124 under the two sheet rows; the split between the two lines is by total, not by person'),
 ('NOV10', 'trx-26-11-11_117', 954545, 'payroll October, Cintya'),
 ('NOV10', 'trx-26-11-11_119', 5917179, 'payroll October, Dewi'),
 ('NOV10', 'trx-26-11-11_124', 19149337, 'payroll October, part of the BNI monthly batch'),
 ('NOV19', 'trx-26-11-11_124', 10999876, 'insentive, the rest of the BNI monthly batch (Rp 124 under the sheet)'),
 ('NOV11', 'trx-26-11-11_129', 669780, 'jasa venner, Sutejo'),
 ('NOV12', 'trx-26-11-11_112', 140000, 'driver Fendi'),
 ('NOV13', 'trx-26-11-11_127', 3988960, 'daily payroll week 1 Nov, one BNI transfer with the Grand Max rent'),
 ('NOV14', 'trx-26-11-11_127', 222000, 'Grand Max rent, the rest of the same transfer; Rp 500 under'),
 ('NOV15', 'trx-26-11-11_085', 14757826, 'BCA 271 to Jenius, top up monthly Jenius cards'),
 ('NOV16', 'trx-26-11-11_130', 500000, 'belanja Saripan, Nur'),
 ('NOV17', 'trx-26-11-11_116', 420000, 'thinner NC super, Surya Bangkit'),
 ('NOV18', 'trx-26-11-11_126', 11000, 'gelas cup'),
 ('NOV20', 'trx-26-11-11_134', 476750, 'Biznet'),
 ('NOV21', 'trx-26-11-11_135', 37000, 'brass hot melt, Tokopedia'),
]
