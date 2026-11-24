/* =========================================================================
 * lib-bands.js — FT-IR 밴드 라이브러리 (엔지니어링 플라스틱 · 고무 · 열경화성)
 * -------------------------------------------------------------------------
 * 원칙:
 *  - 위치(cm⁻¹)는 문헌·일반 귀속의 **대표값**이며 범위로 준다. 실제 시료는
 *    결정형·수소결합·충전제·첨가제 때문에 몇 cm⁻¹~수십 cm⁻¹ 이동한다.
 *  - w(가중치): 3=필수 마커, 2=강한 특징, 1=보조.
 *  - 완벽한 스펙트럼 상관 라이브러리가 아니라 **마커 밴드 규칙 점수**다.
 *    (사용자가 측정한 표준시료를 '라이브러리' 탭에 등록하면 상관계수 대조도 가능)
 * ========================================================================= */
window.FTIR_BANDS = {
  version: '1.0',
  note: '밴드 위치는 문헌 대표값(범위 표기). 정성 판정은 마커 점수 + 사용자 라이브러리 상관으로 보조한다.',

  materials: [
    /* ---------------- 열가소성 엔지니어링 플라스틱 ---------------- */
    { id:'pa6', ko:'PA6 (나일론 6)', en:'Polyamide 6', cls:'열가소성', note:'PA66과 FTIR 단독 구분 어려움(1470/1410, 935 미세차). DSC·용해도 병행 권장.',
      markers:[
        {r:[3290,3310], t:'N–H str (amide A)', w:3},
        {r:[2920,2945], t:'CH₂ asym str', w:1},
        {r:[1625,1650], t:'Amide I (C=O str)', w:3},
        {r:[1528,1550], t:'Amide II (N–H bend + C–N)', w:3},
        {r:[1455,1480], t:'CH₂ scissor', w:1},
        {r:[1400,1425], t:'CH₂ wag / C–C', w:1},
        {r:[1355,1385], t:'Amide III / CH₂', w:1},
        {r:[1250,1275], t:'Amide III', w:2},
        {r:[1185,1210], t:'C–C / C–N skeletal', w:1},
        {r:[1105,1140], t:'C–C skeletal', w:1},
        {r:[920,940],  t:'Amide IV (CONH)', w:2},
        {r:[675,700],  t:'Amide V (N–H oop)', w:2}
      ]},
    { id:'pa66', ko:'PA66 (나일론 66)', en:'Polyamide 66', cls:'열가소성', note:'PA6과 구분: 1475/1410 쌍, 935 위치. 단독 판정보다 비율·DSC 병행.',
      markers:[
        {r:[3290,3315], t:'N–H str (amide A)', w:3},
        {r:[2925,2945], t:'CH₂ asym str', w:1},
        {r:[1630,1652], t:'Amide I (C=O)', w:3},
        {r:[1530,1550], t:'Amide II', w:3},
        {r:[1465,1485], t:'CH₂ scissor', w:2},
        {r:[1400,1420], t:'CH₂ wag / C–N', w:1},
        {r:[1255,1285], t:'Amide III', w:2},
        {r:[1185,1210], t:'skeletal', w:1},
        {r:[925,945],  t:'Amide IV', w:2},
        {r:[675,700],  t:'Amide V', w:2}
      ]},
    { id:'pa9t', ko:'PA9T / PPA (방향족 PA)', en:'Aromatic polyamide (PA9T, PA6T/6I, PPA)', cls:'열가소성',
      note:'방향족 고리 밴드(1600/1500/820)가 지방족 PA와의 결정적 차이. PPA 계열 내 개별 grade 구분은 어려움.',
      markers:[
        {r:[3280,3320], t:'N–H str', w:3},
        {r:[1630,1652], t:'Amide I', w:3},
        {r:[1530,1555], t:'Amide II', w:3},
        {r:[1595,1615], t:'Aromatic ring (C=C)', w:2},
        {r:[1495,1512], t:'Aromatic ring', w:2},
        {r:[815,832],   t:'p-phenylene C–H oop', w:3},
        {r:[1290,1310], t:'C–N / ring', w:1}
      ]},
    { id:'pps', ko:'PPS (폴리페닐렌설파이드)', en:'Polyphenylene sulfide', cls:'열가소성', note:'823 cm⁻¹ 단일 강밴드 + 1573 특유. 충전제(GF) 있으면 1100–1000 광범위.',
      markers:[
        {r:[1570,1585], t:'Aromatic C=C', w:3},
        {r:[1465,1478], t:'Ring vibration', w:2},
        {r:[1380,1395], t:'Ring / CH₂', w:2},
        {r:[1080,1100], t:'C–S / ring', w:2},
        {r:[1005,1025], t:'Ring breathing', w:2},
        {r:[815,832],   t:'p-phenylene C–H oop', w:3},
        {r:[740,755],   t:'C–S', w:1}
      ]},
    { id:'pbt', ko:'PBT (폴리부틸렌테레프탈레이트)', en:'Polybutylene terephthalate', cls:'열가소성', note:'PET와 구분: PBT는 1470/1410 강하고 1340/1240 약함, 917 존재.',
      markers:[
        {r:[1710,1728], t:'Ester C=O str', w:3},
        {r:[1460,1475], t:'CH₂ bend', w:2},
        {r:[1405,1420], t:'Ring / CH₂', w:1},
        {r:[1260,1285], t:'C–O–C asym', w:2},
        {r:[1090,1115], t:'C–O–C sym', w:2},
        {r:[1005,1025], t:'Ring', w:1},
        {r:[910,925],   t:'CH₂ rock', w:2},
        {r:[805,820],   t:'p-phenylene oop', w:2},
        {r:[725,742],   t:'CH₂ rock', w:1}
      ]},
    { id:'pet', ko:'PET (폴리에틸렌테레프탈레이트)', en:'PET', cls:'열가소성',
      markers:[
        {r:[1710,1730], t:'Ester C=O', w:3},
        {r:[1230,1250], t:'C–O–C asym', w:3},
        {r:[1090,1110], t:'C–O–C sym', w:2},
        {r:[1330,1345], t:'CH₂ wag (결정/비정)', w:2},
        {r:[870,880],   t:'Ring oop', w:1},
        {r:[720,735],   t:'Ring / CH₂', w:1}
      ]},
    { id:'mppo', ko:'mPPO (PPE/PS 얼로이)', en:'Modified PPO (PPE/HIPS)', cls:'열가소성',
      note:'PPE의 1190(C–O) + 1025, PS의 698/760이 함께 보이면 얼로이. 698/760 증가 = PS 비율↑.',
      markers:[
        {r:[1185,1195], t:'Aryl ether C–O (PPE)', w:3},
        {r:[1018,1035], t:'Aromatic ring (PPE)', w:2},
        {r:[1485,1500], t:'Aromatic ring', w:1},
        {r:[690,705],   t:'Mono-subst. ring oop (PS)', w:3},
        {r:[750,765],   t:'Mono-subst. ring oop (PS)', w:2},
        {r:[1455,1470], t:'CH₂ scissor', w:1}
      ]},
    { id:'pc', ko:'PC (폴리카보네이트)', en:'Polycarbonate', cls:'열가소성', note:'1775/1740 두 C=O 밴드가 특징.',
      markers:[
        {r:[1770,1785], t:'C=O (free)', w:3},
        {r:[1735,1750], t:'C=O (H-bonded)', w:2},
        {r:[1595,1610], t:'Aromatic ring', w:1},
        {r:[1495,1512], t:'Aromatic ring', w:1},
        {r:[1220,1245], t:'C–O–C asym', w:2},
        {r:[1155,1170], t:'C–O', w:1},
        {r:[825,840],   t:'p-phenylene oop', w:1}
      ]},
    { id:'abs', ko:'ABS / SAN (스티렌-아크릴로니트릴)', en:'ABS, SAN', cls:'열가소성', note:'2237 C≡N이 결정적. SAN/ABS 비율은 2237/698 강도비로 대략 추정(정량 아님).',
      markers:[
        {r:[2230,2245], t:'C≡N str', w:3},
        {r:[1595,1610], t:'Aromatic ring', w:1},
        {r:[1485,1500], t:'Aromatic ring', w:1},
        {r:[755,765],   t:'Mono-subst. ring oop', w:1},
        {r:[690,705],   t:'Mono-subst. ring oop', w:2}
      ]},
    { id:'ps', ko:'PS (폴리스티렌)', en:'Polystyrene', cls:'열가소성',
      markers:[
        {r:[3020,3035], t:'Aromatic C–H str', w:2},
        {r:[2915,2935], t:'CH₂ str', w:1},
        {r:[1595,1610], t:'Ring quadrant', w:2},
        {r:[1488,1500], t:'Ring semicircle', w:2},
        {r:[1448,1460], t:'CH₂ scissor', w:1},
        {r:[755,765],   t:'Mono-subst. oop', w:3},
        {r:[692,705],   t:'Ring oop (out-of-plane)', w:3}
      ]},
    { id:'pp', ko:'PP (폴리프로필렌)', en:'Polypropylene', cls:'열가소성', note:'1456/1377 쌍 + 1167. 이중 결합·카르닐 없음이 열화 판정의 기준선.',
      markers:[
        {r:[2945,2960], t:'CH₃ asym str', w:2},
        {r:[2915,2930], t:'CH₂ asym str', w:3},
        {r:[2835,2850], t:'CH₂ sym str', w:2},
        {r:[1450,1462], t:'CH₂ scissor', w:3},
        {r:[1370,1385], t:'CH₃ sym bend', w:3},
        {r:[1160,1175], t:'C–C skeletal', w:1},
        {r:[990,1000],  t:'CH₃ rock', w:1},
        {r:[965,980],   t:'CH₃ rock', w:1},
        {r:[800,815],   t:'C–C', w:1}
      ]},
    { id:'pe', ko:'PE (HDPE/LDPE)', en:'Polyethylene', cls:'열가소성', note:'720/730 이중선의 상대강도로 결정화도 경향 판단(정량 아님).',
      markers:[
        {r:[2910,2925], t:'CH₂ asym str', w:3},
        {r:[2845,2860], t:'CH₂ sym str', w:3},
        {r:[1462,1475], t:'CH₂ scissor', w:3},
        {r:[1370,1385], t:'CH₃ (branch) bend', w:1},
        {r:[715,735],   t:'CH₂ rock (720/730)', w:3}
      ]},
    { id:'pom', ko:'POM (폴리아세탈)', en:'Polyoxymethylene', cls:'열가소성', note:'1090 부근 강한 C–O–C. 1234/1090 조합이 특징.',
      markers:[
        {r:[1235,1250], t:'C–O–C str', w:2},
        {r:[1075,1100], t:'C–O–C asym str', w:3},
        {r:[1020,1040], t:'C–O–C sym str', w:2},
        {r:[925,945],   t:'CH₂ rock', w:2},
        {r:[1455,1470], t:'CH₂ scissor', w:1}
      ]},
    { id:'pmma', ko:'PMMA (아크릴)', en:'PMMA', cls:'열가소성',
      markers:[
        {r:[1720,1740], t:'C=O ester', w:3},
        {r:[1260,1280], t:'C–O–C', w:2},
        {r:[1225,1250], t:'C–O–C', w:2},
        {r:[1135,1155], t:'C–O–C', w:2},
        {r:[1040,1070], t:'C–C', w:1},
        {r:[980,1000],  t:'CH₃ rock', w:1},
        {r:[830,850],   t:'C–C', w:2},
        {r:[740,760],   t:'CH₂ rock', w:1}
      ]},
    { id:'pvc', ko:'PVC (경질/연질)', en:'PVC', cls:'열가소성', note:'C–Cl 615 부근. 가소제(DOP) 있으면 1730 C=O 등장.',
      markers:[
        {r:[1420,1440], t:'CH₂ bend', w:2},
        {r:[1320,1340], t:'CH bend', w:1},
        {r:[1245,1265], t:'CH₂ wag', w:2},
        {r:[1075,1100], t:'C–C', w:2},
        {r:[955,975],   t:'trans CH₂ rock', w:1},
        {r:[680,700],   t:'C–Cl str', w:2},
        {r:[605,625],   t:'C–Cl str', w:3}
      ]},
    { id:'tpu', ko:'TPU (폴리우레탄 탄성체)', en:'Thermoplastic polyurethane', cls:'열가소성',
      note:'경화 우레탄(열경화)과 스펙트럼 유사 — 열이력/용해도로 구분.',
      markers:[
        {r:[3320,3345], t:'N–H str', w:2},
        {r:[1725,1742], t:'Ester C=O', w:3},
        {r:[1695,1715], t:'H-bonded C=O (우레탄)', w:2},
        {r:[1525,1540], t:'Amide II / NH bend', w:2},
        {r:[1210,1230], t:'C–O–C', w:2},
        {r:[760,775],   t:'Aromatic oop', w:1}
      ]},
    { id:'pa11', ko:'PA11 / PA12 / PA610 (장쇄 지방족 PA)', en:'Long-chain aliphatic polyamides', cls:'열가소성', note:'화학 구조상 PA6/PA66과 매우 유사 — CH₂/NH 비율로 경향만 판단.',
      markers:[
        {r:[3290,3315], t:'N–H str', w:3},
        {r:[1630,1650], t:'Amide I', w:3},
        {r:[1530,1555], t:'Amide II', w:3},
        {r:[1460,1480], t:'CH₂ scissor', w:2},
        {r:[1255,1275], t:'Amide III', w:2},
        {r:[675,700],   t:'Amide V', w:2}
      ]},
    { id:'peek', ko:'PEEK', en:'Polyether ether ketone', cls:'열가소성',
      markers:[
        {r:[1640,1660], t:'Aromatic C=O', w:3},
        {r:[1485,1500], t:'Aromatic ring', w:2},
        {r:[1210,1230], t:'C–O–C asym', w:2},
        {r:[1175,1195], t:'C–O–C', w:2},
        {r:[1005,1020], t:'Ring', w:1},
        {r:[860,875],   t:'Ring oop', w:1}
      ]},
    { id:'psu', ko:'PSU / PES (폴리설폰)', en:'Polysulfone / Polyethersulfone', cls:'열가소성', note:'1150 부근 S=O 대칭 + 1240 비대칭.',
      markers:[
        {r:[1230,1250], t:'C–O–C / S=O asym', w:3},
        {r:[1140,1160], t:'S=O sym', w:3},
        {r:[1485,1500], t:'Aromatic ring', w:1},
        {r:[1005,1020], t:'Ring breathing', w:1},
        {r:[825,845],   t:'p-phenylene oop', w:1}
      ]},

    /* ---------------- 열경화성 ---------------- */
    { id:'epoxy', ko:'에폭시 (DGEBA 계)', en:'Epoxy (DGEBA)', cls:'열경화성',
      note:'915(oxirane) 소실 = 경화 진행 지표. 1510/1610 쌍 + 1245가 DGEBA 특유.',
      markers:[
        {r:[3400,3520], t:'O–H str (경화 후)', w:1},
        {r:[1605,1615], t:'Aromatic ring', w:2},
        {r:[1503,1513], t:'Aromatic ring (DGEBA)', w:3},
        {r:[1235,1255], t:'Aryl–O–C asym', w:3},
        {r:[1175,1195], t:'Aryl–O–C', w:1},
        {r:[1030,1045], t:'C–O–C', w:2},
        {r:[905,922],   t:'Epoxide ring (미경화 지표)', w:3},
        {r:[825,840],   t:'p-phenylene oop', w:2}
      ]},
    { id:'up', ko:'불포화 폴리에스터 (UPR)', en:'Unsaturated polyester', cls:'열경화성',
      note:'1645 C=C 소실 = 경화. 스티렌 잔류(990/700) 확인 가능.',
      markers:[
        {r:[1718,1735], t:'Ester C=O', w:3},
        {r:[1635,1655], t:'C=C (경화 소실)', w:3},
        {r:[1445,1460], t:'CH₂', w:1},
        {r:[1280,1300], t:'C–O', w:1},
        {r:[1110,1130], t:'C–O–C', w:1},
        {r:[975,995],   t:'Styrene =CH₂', w:1},
        {r:[690,710],   t:'Styrene ring oop', w:1}
      ]},
    { id:'phenolic', ko:'페놀수지 (노볼락/레졸)', en:'Phenolic resin', cls:'열경화성',
      note:'1610/1590/1510 삼중 밴드 + 1230 넓은 C–O. 경화도는 1000/1010 부근과 OH로 보조 판단.',
      markers:[
        {r:[3350,3450], t:'O–H str (넓음)', w:1},
        {r:[1605,1615], t:'Aromatic ring', w:2},
        {r:[1585,1595], t:'Aromatic ring', w:2},
        {r:[1505,1515], t:'Aromatic ring', w:3},
        {r:[1465,1480], t:'CH₂ bend', w:1},
        {r:[1220,1245], t:'C–O str (넓음)', w:2},
        {r:[1090,1110], t:'C–O', w:1},
        {r:[815,830],   t:'p-subst. oop', w:1},
        {r:[685,700],   t:'Ring oop', w:1}
      ]},
    { id:'silicone', ko:'실리콘 (PDMS)', en:'Silicone / PDMS', cls:'열경화성',
      note:'1260 Si–CH₃ + 1010–1100 Si–O–Si 이중 특유. 충전 실리카와 겹침 주의.',
      markers:[
        {r:[1255,1268], t:'Si–CH₃ sym bend', w:3},
        {r:[1000,1100], t:'Si–O–Si asym str (넓음)', w:3},
        {r:[790,812],   t:'Si–C str / CH₃ rock', w:2},
        {r:[695,710],   t:'Si–CH₃ rock', w:1},
        {r:[2950,2975], t:'C–H str', w:1}
      ]},

    /* ---------------- 고무(엘라스토머) ---------------- */
    { id:'nr', ko:'NR (천연고무, cis-1,4)', en:'Natural rubber', cls:'고무',
      note:'1663 C=C + 840 cis =CH oop이 조합. 가황 후에도 1663 유지(소량), 산화 시 1710 대역 상승.',
      markers:[
        {r:[3025,3045], t:'=C–H str', w:2},
        {r:[2920,2940], t:'CH₂ asym str', w:3},
        {r:[2845,2865], t:'CH₂ sym str', w:2},
        {r:[1655,1670], t:'C=C str', w:3},
        {r:[1440,1455], t:'CH₂ scissor', w:2},
        {r:[1365,1380], t:'CH₃ sym bend', w:1},
        {r:[1030,1045], t:'C–C / 가황계', w:1},
        {r:[828,845],   t:'cis-1,4 =C–H oop', w:3}
      ]},
    { id:'sbr', ko:'SBR (스티렌-부타디엔)', en:'SBR', cls:'고무',
      note:'스티렌 698/760과 966 trans C=C 동시 존재가 NR과의 차이.',
      markers:[
        {r:[3055,3070], t:'Aromatic C–H str', w:1},
        {r:[3020,3035], t:'Aromatic C–H str', w:1},
        {r:[2915,2935], t:'CH₂ asym str', w:2},
        {r:[1595,1610], t:'Aromatic ring', w:2},
        {r:[1488,1500], t:'Aromatic ring', w:2},
        {r:[955,975],   t:'trans-1,4 C=C oop', w:3},
        {r:[755,765],   t:'Mono-subst. oop', w:2},
        {r:[690,705],   t:'Mono-subst. oop', w:2}
      ]},
    { id:'br', ko:'BR (부타디엔 고무)', en:'Polybutadiene', cls:'고무',
      note:'966(trans) + 910(1,2-vinyl) + 735(cis).',
      markers:[
        {r:[2905,2925], t:'CH₂ str', w:3},
        {r:[2840,2860], t:'CH₂ sym str', w:2},
        {r:[1650,1670], t:'C=C str', w:1},
        {r:[1445,1460], t:'CH₂ scissor', w:1},
        {r:[955,975],   t:'trans-1,4 oop', w:2},
        {r:[900,920],   t:'1,2-vinyl oop', w:2}
      ]},
    { id:'epdm', ko:'EPDM', en:'Ethylene-propylene-diene rubber', cls:'고무',
      note:'포화 탄화수소 — 1600/1000/700 대역에 특징 밴드가 없다는 점이 오히려 식별 근거.',
      markers:[
        {r:[2915,2935], t:'CH₂ asym str', w:3},
        {r:[2845,2865], t:'CH₂ sym str', w:2},
        {r:[1455,1470], t:'CH₂ scissor', w:3},
        {r:[1370,1385], t:'CH₃ sym bend', w:2},
        {r:[715,730],   t:'CH₂ rock', w:1}
      ]},
    { id:'nbr', ko:'NBR (니트릴 고무)', en:'NBR / HNBR', cls:'고무',
      note:'2237 C≡N 세기 = ACN 함량 경향. HNBR은 C=C(966) 감소.',
      markers:[
        {r:[2225,2245], t:'C≡N str', w:3},
        {r:[2915,2935], t:'CH₂ asym str', w:2},
        {r:[2845,2865], t:'CH₂ sym str', w:1},
        {r:[1432,1462], t:'CH₂ scissor', w:1},
        {r:[955,975],   t:'trans C=C oop', w:1}
      ]},
    { id:'cr', ko:'CR (클로로프렌 고무)', en:'Polychloroprene', cls:'고무',
      markers:[
        {r:[1655,1675], t:'C=C str', w:2},
        {r:[1440,1455], t:'CH₂', w:1},
        {r:[1300,1315], t:'CH bend', w:1},
        {r:[1105,1125], t:'C–C', w:1},
        {r:[955,975],   t:'trans C=C oop', w:1},
        {r:[680,700],   t:'C–Cl str', w:1},
        {r:[820,840],   t:'C–Cl / =CH', w:1}
      ]},
    { id:'iir', ko:'IIR (부틸 고무)', en:'Butyl rubber', cls:'고무',
      note:'1365/1390 쌍(이소프로필)과 1225가 특징. 1660은 약함.',
      markers:[
        {r:[2940,2960], t:'CH₃ asym str', w:2},
        {r:[2905,2925], t:'CH₂ asym str', w:2},
        {r:[1465,1480], t:'CH₂ scissor', w:2},
        {r:[1380,1395], t:'CH₃ sym bend', w:2},
        {r:[1358,1372], t:'gem-dimethyl', w:2},
        {r:[1215,1235], t:'C–C skeletal', w:1},
        {r:[940,960],   t:'C=C oop', w:1}
      ]},
    { id:'fkm', ko:'FKM (불소고무)', en:'Fluoroelastomer', cls:'고무',
      note:'1150–1220 C–F 광범위 흡수가 지문. 1400 부근과 조합.',
      markers:[
        {r:[1390,1410], t:'C–C / CF', w:1},
        {r:[1200,1220], t:'C–F str', w:3},
        {r:[1145,1165], t:'C–F str', w:3},
        {r:[1095,1115], t:'C–F str', w:2},
        {r:[875,895],   t:'C–F', w:1}
      ]},

    /* ---------------- 무기 충전제 / 보강재 ---------------- */
    { id:'gf', ko:'유리섬유 (E-glass)', en:'Glass fiber', cls:'무기충전제',
      note:'1000–1100 넓은 Si–O 흡수가 PA/PBT 등 수지 밴드와 겹친다 — 정량 시 주의.',
      markers:[
        {r:[1000,1120], t:'Si–O–Si (넓음)', w:2},
        {r:[780,815],   t:'Si–O', w:1},
        {r:[450,480],   t:'Si–O bend', w:1}
      ]},
    { id:'talc', ko:'탈크', en:'Talc', cls:'무기충전제',
      note:'3676 Mg–OH는 탈크 확인의 결정적 밴드.',
      markers:[
        {r:[3665,3685], t:'Mg–OH str', w:3},
        {r:[1005,1030], t:'Si–O str', w:3},
        {r:[660,680],   t:'Si–O bend', w:1},
        {r:[455,475],   t:'Si–O bend', w:1}
      ]},
    { id:'caco3', ko:'탄산칼슘', en:'Calcium carbonate', cls:'무기충전제',
      note:'1420 넓은 CO₃ + 872 단일 밴드 조합이 특징.',
      markers:[
        {r:[1400,1440], t:'CO₃²⁻ asym str (넓음)', w:3},
        {r:[865,880],   t:'CO₃²⁻ oop bend', w:3},
        {r:[705,720],   t:'CO₃²⁻ bend', w:1}
      ]},
    { id:'silica', ko:'실리카', en:'Silica', cls:'무기충전제',
      markers:[
        {r:[1080,1120], t:'Si–O–Si asym', w:2},
        {r:[790,812],   t:'Si–O sym', w:2},
        {r:[460,480],   t:'Si–O bend', w:1}
      ]},
    { id:'carbonblack', ko:'카본블랙', en:'Carbon black', cls:'무기충전제',
      note:'고유 밴드 없음. 전체 흡광도 상승·기울기·노이즈 증가로만 보인다(정성 식별 불가).',
      markers:[] },

    /* ---------------- 첨가제 ---------------- */
    { id:'stearate', ko:'금속 스테아레이트 (활제/이형제)', en:'Metal stearate', cls:'첨가제',
      note:'1570–1590 / 1530–1550 카르복실레이트 쌍. PA·POM·PP에 흔함.',
      markers:[
        {r:[1570,1592], t:'COO⁻ asym str', w:2},
        {r:[1530,1552], t:'COO⁻ sym str', w:2},
        {r:[1458,1475], t:'CH₂ scissor', w:1},
        {r:[1305,1330], t:'CH₂ wag', w:1}
      ]},
    { id:'erucamide', ko:'에루카마이드 (슬립제)', en:'Erucamide', cls:'첨가제',
      note:'N–H 3300 + amide I 1640이 PA 밴드와 겹친다 — 블룸(bloom) 시 PA로 오판 주의.',
      markers:[
        {r:[3280,3320], t:'N–H str', w:2},
        {r:[1630,1650], t:'Amide I', w:2},
        {r:[1535,1558], t:'Amide II', w:2}
      ]},
    { id:'antioxidant', ko:'페놀계 산화방지제', en:'Hindered phenol AO', cls:'첨가제',
      note:'자유 OH 3630–3650은 미량·약함. 통상 ATR로는 검출 한계 이하.',
      markers:[
        {r:[3620,3652], t:'Free O–H str', w:1}
      ]},

    /* ---------------- 열화·산화 생성물 ---------------- */
    { id:'oxidation', ko:'산화 생성물 (카르보닐/OH)', en:'Oxidation products', cls:'열화',
      note:'카르보닐 대역은 케톤(1715)/알데하이드(1725)/에스터(1735)/산(1750)이 겹친다 — 단일 밴드 귀속 단정 금지.',
      markers:[
        {r:[1700,1770], t:'C=O str (케톤·산·에스터·락톤)', w:3},
        {r:[3200,3500], t:'O–H / hydroperoxide (넓음)', w:2},
        {r:[1600,1645], t:'C=C 공액', w:1},
        {r:[1150,1200], t:'C–O (산화)', w:1}
      ]}
  ],

  /* 지수 프리셋 — 사용자 볼트의 CI 정의(Dong 2010,PA6)를 그대로 포함 */
  indices: [
    { id:'ci_dong', name:'CI — Dong 2010 (PA6, ATR 보정)', short:'CI',
      num:[1710,1760], numBase:[1780,1690], den:[1458,1468], denBase:[1495,1435],
      atr:true, unit:'면적비',
      note:'I(1710–1760)/I(1458–1468). ATR 보정하면 미보정 대비 약 1/1.17 (Dong 2010 방식).' },
    { id:'ci_ketone', name:'CI_ketone (1차 열산화)', short:'CI_ket',
      num:[1710,1720], numBase:[1780,1690], den:[1458,1468], denBase:[1495,1435], atr:true, unit:'면적비',
      note:'케톤 대역만 적분 — 산화 vs 가수분해 구분용(귀속 가정 하).' },
    { id:'ci_acid', name:'CI_acid (카르복실산)', short:'CI_acid',
      num:[1745,1755], numBase:[1780,1690], den:[1458,1468], denBase:[1495,1435], atr:true, unit:'면적비',
      note:'산 대역. 가수분해도 여기를 올린다.' },
    { id:'hbond', name:'H-bond index A(3440)/A(3300)', short:'Hbond',
      type:'point', a:3440, b:3300, atr:false, unit:'흡광도비',
      note:'자유 N–H / 수소결합 N–H. 수분 흡수 시 하락(가역) — 피크 높이 비(베이스라인 미적용).' },
    { id:'ci_pe', name:'CI — PE/PP 범용', short:'CI_PE',
      num:[1710,1725], numBase:[1750,1680], den:[2010,2030], denBase:[2050,1980], atr:false, unit:'면적비',
      note:'A(1715)/A(2020) 관례. 폴리올레핀 열화 모니터링.' },
    { id:'oi_rubber', name:'OI — 고무 산화지수', short:'OI_rubber',
      num:[1700,1740], numBase:[1760,1680], den:[1440,1475], denBase:[1490,1420], atr:true, unit:'면적비',
      note:'카르보닐/CH₂ scissor. NR·SBR·EPDM 열산화 비교용.' }
  ]
};
