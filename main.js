/* ===================== 상수 ===================== */
const TAX_BRACKETS = [
  { limit: 14_000_000,  rate: 0.06, deduc:          0 },
  { limit: 50_000_000,  rate: 0.15, deduc:  1_260_000 },
  { limit: 88_000_000,  rate: 0.24, deduc:  5_760_000 },
  { limit: 150_000_000, rate: 0.35, deduc: 15_440_000 },
  { limit: 300_000_000, rate: 0.38, deduc: 19_940_000 },
  { limit: 500_000_000, rate: 0.40, deduc: 25_940_000 },
  { limit: 1_000_000_000, rate: 0.42, deduc: 35_940_000 },
  { limit: Infinity,    rate: 0.45, deduc: 65_940_000 },
];

const LOCAL_TAX_RATE = 0.10;

const INS = {
  pension: { rate: 0.0475, monthlyCap: 6_370_000 },
  health: { rate: 0.03595 },
  longterm: { rate: 0.004724 },
  employment: { rate: 0.009 },
};

/* ===================== 세율 계산 ===================== */
function calcIncomeTax(taxBase) {
  if (taxBase <= 0) return 0;
  for (const b of TAX_BRACKETS) {
    if (taxBase <= b.limit) return Math.floor(taxBase * b.rate - b.deduc);
  }
  return Math.floor(taxBase * 0.45 - 65_940_000);
}

/* ===================== 근로소득공제 ===================== */
function calcEmploymentDeduction(totalSalary) {
  let d;
  if (totalSalary <= 5_000_000) {
    d = totalSalary * 0.70;
  } else if (totalSalary <= 15_000_000) {
    d = 3_500_000 + (totalSalary - 5_000_000) * 0.40;
  } else if (totalSalary <= 45_000_000) {
    d = 7_500_000 + (totalSalary - 15_000_000) * 0.15;
  } else if (totalSalary <= 100_000_000) {
    d = 12_000_000 + (totalSalary - 45_000_000) * 0.05;
  } else {
    d = 14_750_000 + (totalSalary - 100_000_000) * 0.02;
  }
  return Math.min(Math.floor(d), 20_000_000);
}

/* ===================== 근로소득세액공제 ===================== */
function calcTaxCredit(taxAmount, totalSalary) {
  let credit;
  if (taxAmount <= 1_300_000) {
    credit = Math.floor(taxAmount * 0.55);
  } else {
    credit = 715_000 + Math.floor((taxAmount - 1_300_000) * 0.30);
  }
  let cap;
  if (totalSalary <= 33_000_000) cap = 740_000;
  else if (totalSalary <= 70_000_000) cap = 660_000;
  else cap = 500_000;
  return Math.min(credit, cap);
}

/* ===================== 4대보험 (연간) ===================== */
function calcInsurance(totalSalary) {
  const monthly = totalSalary / 12;
  const pensionBase = Math.min(monthly, INS.pension.monthlyCap);
  const pension = Math.floor(pensionBase * INS.pension.rate) * 12;
  const health = Math.floor(monthly * INS.health.rate) * 12;
  const longterm = Math.floor(monthly * INS.longterm.rate) * 12;
  const employment = Math.floor(monthly * INS.employment.rate) * 12;
  return { pension, health, longterm, employment, total: pension + health + longterm + employment };
}

/* ===================== 메인 계산 ===================== */
function calcAll(salary, dividend) {
  const retiredMode = salary === 0;
  const THRESHOLD   = 20_000_000;
  const personalDeduc = 1_500_000;

  let ins = { pension:0, health:0, longterm:0, employment:0, total:0 };
  let empDeduc=0, grossIncome=0, salaryTaxBase=0;
  let salaryRawTax=0, taxCredit=0, salaryFinalTax=0, salaryLocalTax=0, salaryTotalTax=0;
  let salaryNet = 0;
  const standardCredit = retiredMode ? 70_000 : 130_000;

  if (!retiredMode) {
    ins          = calcInsurance(salary);
    empDeduc     = calcEmploymentDeduction(salary);
    grossIncome  = Math.max(salary - empDeduc, 0);
    salaryTaxBase= Math.max(grossIncome - personalDeduc, 0);
    salaryRawTax = Math.max(calcIncomeTax(salaryTaxBase), 0);
    taxCredit    = calcTaxCredit(salaryRawTax, salary);
    salaryFinalTax  = Math.max(salaryRawTax - taxCredit - standardCredit, 0);
    salaryLocalTax  = Math.floor(salaryFinalTax * LOCAL_TAX_RATE);
    salaryTotalTax  = salaryFinalTax + salaryLocalTax;
    salaryNet       = salary - ins.total - salaryTotalTax;
  }

  let divTax, divTaxMethod, divFinalTax, divLocalTax;
  let divTaxBase = 0, divRawTax = 0;

  if (dividend <= THRESHOLD) {
    divTax      = Math.floor(dividend * 0.154);
    divTaxMethod= 'separate';
    divFinalTax = Math.floor(dividend * 0.14);
    divLocalTax = Math.floor(dividend * 0.014);

  } else if (retiredMode) {
    const excess = dividend - THRESHOLD;

    const taxBase_A  = Math.max(dividend - personalDeduc, 0);
    const rawTax_A   = calcIncomeTax(taxBase_A);
    const finalTax_A = Math.max(rawTax_A - standardCredit, 0);
    const localTax_A = Math.floor(finalTax_A * LOCAL_TAX_RATE);
    const total_A    = finalTax_A + localTax_A;

    const taxBase_B  = Math.max(excess - personalDeduc, 0);
    const rawTax_B   = calcIncomeTax(taxBase_B);
    const finalTax_B = Math.max(rawTax_B - standardCredit, 0);
    const localTax_B = Math.floor(finalTax_B * LOCAL_TAX_RATE);
    const total_B    = Math.floor(THRESHOLD * 0.154) + finalTax_B + localTax_B;

    if (total_A >= total_B) {
      divTax = total_A; divTaxMethod = 'comprehensive_A';
      divTaxBase = taxBase_A; divRawTax = rawTax_A;
      divFinalTax = finalTax_A; divLocalTax = localTax_A;
    } else {
      divTax = total_B; divTaxMethod = 'comprehensive_B';
      divTaxBase = taxBase_B; divRawTax = rawTax_B;
      divFinalTax = finalTax_B; divLocalTax = localTax_B;
    }

  } else {
    const excess = dividend - THRESHOLD;

    const combinedTaxBase  = salaryTaxBase + dividend;
    const combinedRawTax   = Math.max(calcIncomeTax(combinedTaxBase), 0);
    const combinedFinalTax = Math.max(combinedRawTax - taxCredit - standardCredit, 0);
    const methodA_totalTax = combinedFinalTax + Math.floor(combinedFinalTax * LOCAL_TAX_RATE);
    const methodA_divTax   = methodA_totalTax - (salaryFinalTax + salaryLocalTax);

    const excessTaxBase  = salaryTaxBase + excess;
    const excessRawTax   = Math.max(calcIncomeTax(excessTaxBase), 0);
    const excessFinalTax = Math.max(excessRawTax - taxCredit - standardCredit, 0);
    const excessLocalTax = Math.floor(excessFinalTax * LOCAL_TAX_RATE);
    const excessDivTax   = (excessFinalTax + excessLocalTax) - (salaryFinalTax + salaryLocalTax);
    const methodB_divTax = Math.floor(THRESHOLD * 0.154) + Math.max(excessDivTax, 0);

    if (methodA_divTax >= methodB_divTax) {
      divTax = Math.max(methodA_divTax, 0); divTaxMethod = 'comprehensive_A';
    } else {
      divTax = methodB_divTax; divTaxMethod = 'comprehensive_B';
    }
    divFinalTax = Math.floor(divTax / 1.1);
    divLocalTax = divTax - divFinalTax;
  }

  let effectiveTaxBase = salaryTaxBase;
  if (dividend > THRESHOLD) {
    const excess = dividend - THRESHOLD;
    if (retiredMode) {
      effectiveTaxBase = divTaxBase;
    } else if (divTaxMethod === 'comprehensive_A') {
      effectiveTaxBase = salaryTaxBase + dividend;
    } else {
      effectiveTaxBase = salaryTaxBase + excess;
    }
  }

  let divHealthIns = 0, divLongtermIns = 0;
  if (retiredMode && dividend > THRESHOLD) {
    divHealthIns  = Math.floor(dividend * 0.0719);
    divLongtermIns= Math.floor(divHealthIns * (0.9448 / 7.19));
  } else if (!retiredMode && dividend > THRESHOLD) {
    divHealthIns  = Math.floor((dividend - THRESHOLD) * 0.0719);
    divLongtermIns= Math.floor((dividend - THRESHOLD) * 0.0719 * (0.9448 / 7.19));
  }

  const divNet = dividend - divTax - divHealthIns - divLongtermIns;

  return {
    retiredMode, salary, dividend,
    ins, standardCredit,
    empDeduc, grossIncome, personalDeduc, salaryTaxBase,
    salaryRawTax, taxCredit, salaryFinalTax, salaryLocalTax, salaryTotalTax,
    salaryNet,
    divTaxBase, divRawTax,
    divTax, divHealthIns, divLongtermIns, divNet, divTaxMethod, divFinalTax, divLocalTax,
    effectiveTaxBase,
    totalNet: salaryNet + divNet,
  };
}

/* ===================== 현재 과세표준 구간 ===================== */
function activeBracket(taxBase) {
  for (let i = 0; i < TAX_BRACKETS.length; i++) {
    if (taxBase <= TAX_BRACKETS[i].limit) return i;
  }
  return TAX_BRACKETS.length - 1;
}

/* ===================== 포맷 ===================== */
function fmt(n) {
  return Math.round(n).toLocaleString('ko-KR') + '원';
}
function fmtShort(n) {
  if (Math.abs(n) >= 1_0000_0000) return (n / 1_0000_0000).toFixed(1) + '억원';
  if (Math.abs(n) >= 1_0000) return Math.round(n / 10_000).toLocaleString('ko-KR') + '만원';
  return Math.round(n).toLocaleString('ko-KR') + '원';
}

/* ===================== UI 렌더 ===================== */
function renderRows(tbodyId, rows) {
  const tbody = document.getElementById(tbodyId);
  tbody.innerHTML = '';
  for (const row of rows) {
    if (row.empty) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="2" style="text-align:center;color:var(--muted);padding:24px 0;font-size:0.85rem;">${row.message}</td>`;
      tbody.appendChild(tr);
    } else if (row.section) {
      const tr = document.createElement('tr');
      tr.className = 'section-header';
      tr.innerHTML = `<td colspan="2">${row.section}</td>`;
      tbody.appendChild(tr);
    } else if (row.total) {
      const tr = document.createElement('tr');
      tr.className = 'total';
      tr.innerHTML = `<td>${row.label}</td><td>${row.value}</td>`;
      tbody.appendChild(tr);
    } else {
      const tr = document.createElement('tr');
      if (row.cls) tr.className = row.cls;
      tr.innerHTML = `<td>${row.label}</td><td>${row.value}</td>`;
      tbody.appendChild(tr);
      if (row.note) {
        const nt = document.createElement('tr');
        nt.className = 'note';
        nt.innerHTML = `<td colspan="2">↳ ${row.note}</td>`;
        tbody.appendChild(nt);
      }
    }
  }
}

function calculate() {
  const salary = parseFloat(document.getElementById('salary').value) || 0;
  const dividend = parseFloat(document.getElementById('dividend').value) || 0;
  const r = calcAll(salary, dividend);

  document.getElementById('salaryMonthly').textContent = fmtShort(r.salaryNet / 12);
  document.getElementById('salaryYearly').textContent = '연 ' + fmtShort(r.salaryNet);
  document.getElementById('divMonthly').textContent = fmtShort(r.divNet / 12);
  document.getElementById('divYearly').textContent = '연 ' + fmtShort(r.divNet);
  document.getElementById('totalMonthly').textContent = fmtShort(r.totalNet / 12);
  document.getElementById('totalYearly').textContent = '연 ' + fmtShort(r.totalNet);

  /* 근로소득 패널 */
  const salaryRows = [];
  const addS = (label, value, cls = '', note = '') => salaryRows.push({ label, value, cls, note });

  if (r.salary === 0) {
    salaryRows.push({ empty: true, message: '근로소득이 없습니다.' });
    salaryRows.push({ total: true, label: '세후 (연)', value: '0원' });
    salaryRows.push({ total: true, label: '월 실수령', value: '0원' });
  } else {
    salaryRows.push({ section: '소득 및 공제' });
    addS('총 급여 (세전)', fmt(r.salary));
    addS('근로소득공제', '−' + fmt(r.empDeduc), 'deduct');
    addS('기본공제 (본인)', '−' + fmt(r.personalDeduc), 'deduct');
    addS('과세표준', fmt(r.salaryTaxBase));

    salaryRows.push({ section: '소득세' });
    addS('산출세액', fmt(r.salaryRawTax));
    addS('근로소득세액공제', '−' + fmt(r.taxCredit), 'deduct');
    addS('표준세액공제', '−' + fmt(r.standardCredit), 'deduct');
    addS('결정세액', fmt(r.salaryFinalTax));
    addS('지방소득세 (10%)', '−' + fmt(r.salaryLocalTax), 'deduct');

    salaryRows.push({ section: '🏥 4대보험 (직원 부담)' });
    addS('국민연금 (4.75%)', '−' + fmt(r.ins.pension), 'deduct');
    addS('건강보험 (3.595%)', '−' + fmt(r.ins.health), 'deduct');
    addS('장기요양 (0.4724%)', '−' + fmt(r.ins.longterm), 'deduct');
    addS('고용보험 (0.9%)', '−' + fmt(r.ins.employment), 'deduct');

    salaryRows.push({ total: true, label: '세후 (연)', value: fmt(r.salaryNet) });
    salaryRows.push({ total: true, label: '월 실수령', value: fmtShort(r.salaryNet / 12) });
  }
  renderRows('salaryBreakdownBody', salaryRows);

  /* 금융소득 패널 */
  const divRows = [];
  const addD = (label, value, cls = '', note = '') => divRows.push({ label, value, cls, note });

  const methodLabel = r.divTaxMethod === 'separate'
    ? '분리과세 15.4% <span class="badge badge-blue">2,000만원 이하</span>'
    : r.retiredMode
      ? '종합과세 <span class="badge badge-purple">금융소득 전용</span>'
      : r.divTaxMethod === 'comprehensive_A'
        ? '종합과세 합산 <span class="badge badge-yellow">2,000만원 초과</span>'
        : '종합과세 비교 <span class="badge badge-yellow">2,000만원 초과</span>';

  divRows.push({ section: '과세 방식' });
  addD('금융소득 (세전)', fmt(r.dividend));
  addD('세금 방식', methodLabel);

  divRows.push({ section: '소득세' });
  if (r.retiredMode && r.divTaxMethod !== 'separate') {
    addD('기본공제 (본인)', '−' + fmt(r.personalDeduc), 'deduct');
    addD('과세표준', fmt(r.divTaxBase));
    addD('산출세액', fmt(r.divRawTax));
    addD('표준세액공제 (7만원)', '−' + fmt(r.standardCredit), 'deduct');
    addD('결정세액', fmt(r.divFinalTax));
    addD('지방소득세', '−' + fmt(r.divLocalTax), 'deduct');
  } else {
    addD('소득세', '−' + fmt(r.divFinalTax), 'deduct');
    addD('지방소득세', '−' + fmt(r.divLocalTax), 'deduct');
  }

  if (r.divHealthIns > 0) {
    const healthLabel = r.retiredMode ? '🏥 지역가입자 건강보험' : '🏥 소득월액 건강보험';
    const healthNote  = r.retiredMode
      ? '금융소득 전액 × 7.19% · 지역가입자 전액 부담'
      : '(금융소득 − 2,000만원) × 7.19% · 사업주 분담 없음';
    divRows.push({ section: healthLabel });
    addD('건강보험 (7.19%)', '−' + fmt(r.divHealthIns), 'deduct', healthNote);
    addD('장기요양보험', '−' + fmt(r.divLongtermIns), 'deduct');
  }

  divRows.push({ total: true, label: '세후 (연)', value: fmt(r.divNet) });
  divRows.push({ total: true, label: '월 실수령', value: fmtShort(r.divNet / 12) });
  renderRows('divBreakdownBody', divRows);

  /* 합산 요약 */
  document.getElementById('summaryMonthly').textContent = fmtShort(r.totalNet / 12);
  document.getElementById('summaryYearly').textContent = fmt(r.totalNet);

  /* Info banner */
  const effSalaryRate = r.salary > 0
    ? ((r.salary - r.salaryNet) / r.salary * 100).toFixed(1) : 0;
  const effDivRate = r.dividend > 0
    ? ((r.divTax + r.divHealthIns + r.divLongtermIns) / r.dividend * 100).toFixed(1) : 0;

  let bannerHTML = r.retiredMode
    ? `🌅 <strong>금융소득 전용(은퇴) 모드</strong> · 표준세액공제 7만원 · 지역가입자 건강보험 적용 &nbsp;|&nbsp; 금융소득 실효세율: <strong>${effDivRate}%</strong>`
    : `근로소득 실효세율(4대보험 포함): <strong>${effSalaryRate}%</strong> &nbsp;|&nbsp; 금융소득 실효세율(건강보험 포함): <strong>${effDivRate}%</strong>`;
  if (r.dividend > 20_000_000) {
    bannerHTML += r.retiredMode
      ? `<br>⚠️ 금융소득 <strong>2,000만원 초과</strong> → 종합과세 + 지역가입자 건강보험(금융소득 전액 × 7.19%) 적용`
      : `<br>⚠️ 금융소득 <strong>2,000만원 초과</strong> → 종합과세 + 소득월액 건강보험(초과분 × 7.19%) 추가 부담`;
  }
  document.getElementById('infoBanner').innerHTML = bannerHTML;

  /* Tax bracket highlight */
  const activeIdx = activeBracket(r.effectiveTaxBase);
  const rows2 = document.querySelectorAll('#taxBracketTable tr');
  rows2.forEach((tr, i) => {
    tr.classList.toggle('active', i === activeIdx);
  });
}

/* ===================== 슬라이더 동기화 ===================== */
function syncSlider(id) {
  const val = parseFloat(document.getElementById(id).value) || 0;
  document.getElementById(id + 'Range').value = val;
  updateSliderLabel(id, val);
}
function syncInput(id) {
  const val = parseFloat(document.getElementById(id + 'Range').value) || 0;
  document.getElementById(id).value = val;
  updateSliderLabel(id, val);
}
function updateSliderLabel(id, val) {
  document.getElementById(id + 'Label').textContent = fmtShort(val);
}

/* ===================== 과세표준 테이블 렌더 ===================== */
function renderTaxTable() {
  const labels = [
    '1,400만원 이하', '1,400만원 ~ 5,000만원', '5,000만원 ~ 8,800만원',
    '8,800만원 ~ 1.5억', '1.5억 ~ 3억', '3억 ~ 5억', '5억 ~ 10억', '10억 초과'
  ];
  const tbody = document.getElementById('taxBracketTable');
  TAX_BRACKETS.forEach((b, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${labels[i]}</td>
      <td>${(b.rate * 100).toFixed(0)}%</td>
      <td>${b.deduc.toLocaleString('ko-KR')}원</td>`;
    tbody.appendChild(tr);
  });
}

/* ===================== 이미지 내보내기 ===================== */
function exportImage() {
  const btn = document.querySelector('.export-btn');
  btn.disabled = true;
  btn.textContent = '⏳ 생성 중...';

  const target = document.getElementById('resultArea');
  html2canvas(target, {
    backgroundColor: '#0f1117',
    scale: 2,
    useCORS: true,
  }).then(canvas => {
    const link = document.createElement('a');
    link.download = '은퇴바라기_실수령계산.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  }).finally(() => {
    btn.disabled = false;
    btn.innerHTML = '📷 이미지로 내보내기';
  });
}

/* ===================== 초기화 ===================== */
renderTaxTable();
syncSlider('salary');
syncSlider('dividend');
calculate();
