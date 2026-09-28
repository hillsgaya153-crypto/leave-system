const SUPABASE_URL  = 'https://wbcqdoypnewadcdfegrh.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndiY3Fkb3lwbmV3YWRjZGZlZ3JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4NjA2ODgsImV4cCI6MjA5NTQzNjY4OH0.ozFqzeH-7557OLb7vuYl9ibacuIctJFFWCnvYAK6JmM';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

const DEPT_LABELS = { Engineering: 'CCR', salesHR: 'Risk', finance: 'Finance', operations: 'IT' };
function deptLabel(d) { return DEPT_LABELS[d] || d || '—'; }
function roleLabel(r) { return { employee: 'Employee', team_lead: 'Team Lead', hr: 'HR', admin: 'Admin' }[r] || r; }

let currentUser    = null;
let currentProfile = null;
let allRequests    = [];
let allProfiles    = [];
let historyFilter  = 'all';
let adminFilter    = 'all';
let currentDenyRequestId = null;
let hrRequests     = [];
let hrDeptFilter   = 'all';
let hrStatusFilter = 'all';
const today        = new Date();
let calYear        = today.getFullYear();
let calMonth       = today.getMonth();
let adminCalYear   = today.getFullYear();
let adminCalMonth  = today.getMonth();

(async () => {
  const { data: { session } } = await db.auth.getSession();
  if (session?.user) await afterLogin(session.user);
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN'  && session?.user && !currentUser) await afterLogin(session.user);
    if (event === 'SIGNED_OUT') resetUI();
  });
})();

function switchAuthTab(tab) {
  document.getElementById('login-form').style.display  = tab === 'login'  ? '' : 'none';
  document.getElementById('signup-form').style.display = tab === 'signup' ? '' : 'none';
  document.querySelectorAll('.auth-tab').forEach((t, i) =>
    t.classList.toggle('active', (i === 0) === (tab === 'login'))
  );
  document.getElementById('auth-heading').textContent =
    tab === 'login' ? 'Welcome back' : 'Create account';
  document.getElementById('auth-sub').textContent =
    tab === 'login' ? 'Sign in to manage your leave requests.' : 'Set up your employee profile.';
  showAuthMsg('', '');
}

function showAuthMsg(msg, type) {
  const el = document.getElementById('auth-msg');
  el.textContent = msg;
  el.className = 'auth-msg' + (msg ? ` show ${type}` : '');
}

function setAuthLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.innerHTML = loading
    ? `<span class="spinner"></span> Please wait…`
    : (btnId === 'login-btn' ? 'Sign in →' : 'Create account →');
}

function phoneToEmail(phone) {
  return phone.replace(/\s/g, '') + '@onfon.local';
}

async function doSignIn() {
  const phone = document.getElementById('login-phone').value.trim();
  const pass  = document.getElementById('login-pass').value;
  if (!phone || !pass) return showAuthMsg('Phone number and password are required.', 'error');
  setAuthLoading('login-btn', true);
  const { data, error } = await db.auth.signInWithPassword({
    email: phoneToEmail(phone), password: pass,
  });
  setAuthLoading('login-btn', false);
  if (error) return showAuthMsg(
    error.message === 'Invalid login credentials' ? 'Incorrect phone number or password.' : error.message,
    'error'
  );
  await afterLogin(data.user);
}

async function doSignUp() {
  const name  = document.getElementById('signup-name').value.trim();
  const phone = document.getElementById('signup-phone').value.trim();
  const dept  = document.getElementById('signup-dept').value;
  const pass  = document.getElementById('signup-pass').value;
  if (!name)           return showAuthMsg('Full name is required.', 'error');
  if (!phone)          return showAuthMsg('Phone number is required.', 'error');
  if (!dept)           return showAuthMsg('Please select a department.', 'error');
  if (pass.length < 6) return showAuthMsg('Password must be at least 6 characters.', 'error');
  setAuthLoading('signup-btn', true);
  const { data, error } = await db.auth.signUp({
    email: phoneToEmail(phone), password: pass,
    options: { data: { full_name: name, phone: phone.replace(/\s/g,''), department: dept, role: 'employee' } },
  });
  setAuthLoading('signup-btn', false);
  if (error) return showAuthMsg(error.message, 'error');
  if (data.session) {
    showAuthMsg('Account created! Signing you in…', 'success');
    setTimeout(() => afterLogin(data.user), 800);
  } else {
    showAuthMsg('Account created! You can now sign in.', 'success');
    setTimeout(() => switchAuthTab('login'), 1500);
  }
}

async function doSignOut() {
  await db.auth.signOut();
  showToast('Signed out. See you soon!');
}

function resetUI() {
  currentUser = currentProfile = null;
  allRequests = []; allProfiles = [];
  document.getElementById('main-wrap').style.display = 'none';
  document.getElementById('nav-user').classList.remove('show');
  document.getElementById('nav-role').classList.remove('show');
  document.getElementById('signout-btn').style.display = 'none';
  document.getElementById('auth-overlay').classList.remove('hidden');
  document.getElementById('login-phone').value = '';
  document.getElementById('login-pass').value  = '';
  showAuthMsg('', '');
  switchAuthTab('login');
}

async function afterLogin(user) {
  currentUser = user;

  const { data: profile, error } = await db
    .from('profiles').select('*').eq('id', user.id).single();

  if (error) {
    const msg = error.code === 'PGRST116'
      ? 'Profile not found — run the schema SQL in Supabase first.'
      : 'Database error: ' + error.message;
    showAuthMsg(msg, 'error');
    await db.auth.signOut();
    return;
  }
  if (!profile) {
    showAuthMsg('Profile missing. Sign up again.', 'error');
    await db.auth.signOut();
    return;
  }
  currentProfile = profile;

  const { data: profiles } = await db
    .from('profiles')
    .select('id, full_name, department, role, annual_left, sick_left, emergency_left')
    .order('full_name');
  allProfiles = profiles || [];

  document.getElementById('auth-overlay').classList.add('hidden');
  document.getElementById('main-wrap').style.display = '';
  document.getElementById('nav-user').textContent = profile.full_name;
  document.getElementById('nav-user').classList.add('show');
  document.getElementById('nav-role').textContent = roleLabel(profile.role);
  document.getElementById('nav-role').classList.add('show');
  document.getElementById('signout-btn').style.display = '';

  document.getElementById('admin-view').classList.remove('active');
  document.getElementById('employee-view').classList.remove('active');
  document.getElementById('hr-view').classList.remove('active');

  if (profile.role === 'admin' || profile.role === 'team_lead') {
    document.getElementById('admin-view').classList.add('active');
    await loadAdminData();
  } else if (profile.role === 'hr') {
    document.getElementById('hr-view').classList.add('active');
    await loadHRData();
  } else {
    document.getElementById('employee-view').classList.add('active');

    const h = new Date().getHours();
    document.getElementById('emp-greeting').textContent =
      `Good ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}, ${profile.full_name.split(' ')[0]}`;
    populateHandoverSelect();
    setMinDates();
    await loadEmployeeData();
  }
}

async function loadEmployeeData() {
  const { data } = await db
    .from('leave_requests')
    .select('*, profiles!leave_requests_user_id_fkey(full_name)')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  allRequests = data || [];
  updateBalanceDisplay();
  renderHistoryList();
  renderCalendar();
}

function updateBalanceDisplay() {
  if (!currentProfile) return;
  const used = allRequests
    .filter(r => r.user_id === currentProfile.id && r.status === 'Approved')
    .reduce((s, r) => s + r.days, 0);

  document.getElementById('bal-annual').textContent    = currentProfile.annual_left;
  document.getElementById('bal-sick').textContent      = currentProfile.sick_left;
  document.getElementById('bal-emergency').textContent = currentProfile.emergency_left;
  document.getElementById('bal-used').textContent      = used;
}

function populateHandoverSelect() {
  const sel = document.getElementById('handover-to');
  sel.innerHTML = '<option value="">Select colleague</option>';
  allProfiles
    .filter(p => p.role === 'admin')
    .forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.full_name;
      opt.textContent = p.full_name;
      sel.appendChild(opt);
    });
}

function switchEmpTab(tab) {
  document.querySelectorAll('.emp-tab-content').forEach(el => el.style.display = 'none');
  document.getElementById('emp-' + tab).style.display = '';
  document.querySelectorAll('#employee-view .view-tabs .view-tab').forEach((t, i) =>
    t.classList.toggle('active', ['request','history','calendar'][i] === tab)
  );
  if (tab === 'history')  renderHistoryList();
  if (tab === 'calendar') renderCalendar();
}

function setMinDates() {
  const t = new Date().toISOString().split('T')[0];
  document.getElementById('leave-start').min = t;
  document.getElementById('leave-end').min   = t;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('leave-start').addEventListener('change', () => {
    const s = document.getElementById('leave-start').value;
    document.getElementById('leave-end').min = s || '';
    updateDuration();
  });
  document.getElementById('leave-end').addEventListener('change', updateDuration);
});

function updateDuration() {
  const s = document.getElementById('leave-start').value;
  const e = document.getElementById('leave-end').value;
  const hint = document.getElementById('leave-duration-hint');
  if (s && e) {
    if (e < s) { hint.textContent = 'End date must be on or after start date.'; return; }
    const days = calcWorkingDays(s, e);
    hint.textContent = days > 0
      ? `${days} working day${days === 1 ? '' : 's'} selected`
      : 'No working days in selected range.';
  } else { hint.textContent = ''; }
}

function calcWorkingDays(start, end) {
  let count = 0;
  const cur = new Date(start + 'T00:00:00');
  const fin = new Date(end   + 'T00:00:00');
  while (cur <= fin) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

async function submitLeave() {
  hideAlert('leave-success'); hideAlert('leave-error');
  const type     = document.getElementById('leave-type').value;
  const start    = document.getElementById('leave-start').value;
  const end      = document.getElementById('leave-end').value;
  const reason   = document.getElementById('leave-reason').value.trim();
  const handover = document.getElementById('handover-to').value;
  const fileInput = document.getElementById('leave-document');
  const file = fileInput.files[0];

  if (!type)       return showAlert('leave-error', 'Please select a leave type.');
  if (!start)      return showAlert('leave-error', 'Please select a start date.');
  if (!end)        return showAlert('leave-error', 'Please select an end date.');
  if (end < start) return showAlert('leave-error', 'End date cannot be before start date.');
  if (!file)        return showAlert('leave-error', 'A supporting document is required.');

  const allowedExt = ['.doc', '.docx','.pdf','.png'];
  const fileName = file.name.toLowerCase();
  const validExt = allowedExt.some(ext => fileName.endsWith(ext));
  if (!validExt) return showAlert('leave-error', 'Document must be a .doc or .docx file or .PDF or .png');
  if (file.size > 10 * 1024 * 1024) return showAlert('leave-error', 'Document must be under 10MB.');

  const days = calcWorkingDays(start, end);
  if (days === 0) return showAlert('leave-error', 'Selected dates include no working days.');

  const balKey = type === 'Annual' ? 'annual_left'
    : type === 'Sick' ? 'sick_left'
    : type === 'Emergency' ? 'emergency_left'
    : type === 'Maternity' ? 'maternity_left'
    : type === 'Paternity' ? 'paternity_left'
    : null;
  if (balKey && currentProfile[balKey] < days)
    return showAlert('leave-error', `Insufficient ${type.toLowerCase()} leave balance. You have ${currentProfile[balKey]} day(s) remaining.`);

  const btn = document.getElementById('submit-leave-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Uploading document…';

  const fileExt = fileName.substring(fileName.lastIndexOf('.'));
  const filePath = `${currentProfile.id}/${Date.now()}${fileExt}`;

  const { error: uploadError } = await db.storage
    .from('leave-documents')
    .upload(filePath, file);

  if (uploadError) {
    btn.disabled = false;
    btn.textContent = 'Submit Request';
    return showAlert('leave-error', 'Document upload failed: ' + uploadError.message);
  }

  btn.innerHTML = '<span class="spinner"></span> Submitting…';

  const { error } = await db.from('leave_requests').insert({
    user_id: currentProfile.id, leave_type: type,
    start_date: start, end_date: end, days,
    reason: reason || null, handover_to: handover || null, status: 'Pending',
    document_path: filePath,
  });

  btn.disabled = false;
  btn.textContent = 'Submit Request';

  if (error) return showAlert('leave-error', error.message);

  ['leave-type','leave-start','leave-end','leave-reason','handover-to']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  fileInput.value = '';
  document.getElementById('leave-duration-hint').textContent = '';
  showAlert('leave-success', `Your ${type} leave request for ${days} working day(s) has been submitted for approval.`);
  await loadEmployeeData();
}

function filterHistory(btn, filter) {
  historyFilter = filter;
  document.querySelectorAll('#emp-history .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderHistoryList();
}

function renderHistoryList() {
  if (!currentProfile) return;
  const list = document.getElementById('history-list');
  let items = allRequests.filter(r => r.user_id === currentProfile.id);
  if (historyFilter !== 'all') items = items.filter(r => r.status === historyFilter);
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">🗂</span><strong>No leave records</strong><p>Your leave history will appear here.</p></div>`;
    return;
  }
  list.innerHTML = items.map(r => `
    <div class="history-item">
      <div class="history-meta">
        <div class="history-type">${r.leave_type} Leave</div>
        <div class="history-dates">${formatDate(r.start_date)} – ${formatDate(r.end_date)}${r.reason ? ` · ${r.reason}` : ''}</div>
        ${r.status === 'Rejected' && r.rejection_reason ? `<div class="history-dates" style="color:var(--danger)">Reason: ${r.rejection_reason}</div>` : ''}
        ${r.document_path ? `<div class="history-dates"><a href="#" onclick="viewDocument('${r.document_path}'); return false;">View document</a></div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:.75rem">
        <div class="history-days">${r.days}d</div>
        <span class="badge badge-${r.status.toLowerCase()}">${r.status}</span>
      </div>
    </div>`).join('');
}

function changeMonth(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  renderCalendar();
}
function renderCalendar() { renderCal('cal-grid', 'cal-month-label', calYear, calMonth); }

async function loadAdminData() {
  const [{ data: reqs }, { data: stats }, { data: profiles }] = await Promise.all([
    db.from('leave_requests')
      .select('*, profiles!leave_requests_user_id_fkey(full_name, department)')
      .order('created_at', { ascending: false }),
    db.from('admin_stats').select('*').single(),
    db.from('profiles')
      .select('id, full_name, department, role, annual_left, sick_left, emergency_left')
      .order('full_name'),
  ]);
  allRequests = reqs || [];
  allProfiles = profiles || allProfiles;
  if (stats) {
    document.getElementById('stat-pending').textContent  = stats.pending_count       ?? 0;
    document.getElementById('stat-approved').textContent = stats.approved_this_month ?? 0;
    document.getElementById('stat-on-leave').textContent = stats.on_leave_today      ?? 0;
  }
  renderRequestsTable();
  renderTeamTable();
  renderAdminCalendar();
}

async function loadHRData() {
  const [{ data: reqs }, { data: deptStats }] = await Promise.all([
    db.from('leave_requests')
      .select('*, profiles!leave_requests_user_id_fkey(full_name, department)')
      .order('created_at', { ascending: false }),
    db.from('department_stats').select('*').order('department'),
  ]);
  hrRequests = reqs || [];
  renderDeptCards(deptStats || []);
  renderDeptTable(deptStats || []);
  renderHRDeptFilter();
  renderHRRequestsTable();
}

function renderDeptCards(stats) {
  const wrap = document.getElementById('hr-dept-cards');
  if (!stats.length) {
    wrap.innerHTML = `<div class="empty-state"><span class="empty-icon">🏢</span><strong>No department data</strong></div>`;
    return;
  }
  wrap.innerHTML = `<div class="dept-grid">` + stats.map(s => `
    <div class="dept-card">
      <div class="dept-card-title">${deptLabel(s.department)}</div>
      <div class="dept-card-row"><span>${s.headcount}</span>employees</div>
      <div class="dept-card-row"><span>${s.on_leave_today}</span>on leave today</div>
      <div class="dept-card-row"><span>${s.pending_count}</span>pending requests</div>
    </div>`).join('') + `</div>`;
}

function renderDeptTable(stats) {
  document.getElementById('hr-dept-tbody').innerHTML = stats.map(s => `
    <tr>
      <td class="td-name">${deptLabel(s.department)}</td>
      <td>${s.headcount}</td>
      <td>${s.on_leave_today}</td>
      <td>${s.pending_count}</td>
      <td>${s.approved_this_month}</td>
    </tr>`).join('');
}

function renderHRDeptFilter() {
  const depts = [...new Set(allProfiles.map(p => p.department))].sort();
  const wrap = document.getElementById('hr-dept-filter');
  wrap.innerHTML = `<button class="filter-btn active" onclick="filterHRDept(this,'all')">All Departments</button>` +
    depts.map(d => `<button class="filter-btn" onclick="filterHRDept(this,'${d}')">${deptLabel(d)}</button>`).join('');
}

function filterHRDept(btn, dept) {
  hrDeptFilter = dept;
  document.querySelectorAll('#hr-dept-filter .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderHRRequestsTable();
}

function filterHRStatus(btn, status) {
  hrStatusFilter = status;
  document.querySelectorAll('#hr-status-filter .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderHRRequestsTable();
}

function renderHRRequestsTable() {
  let items = [...hrRequests];
  if (hrDeptFilter !== 'all') items = items.filter(r => r.profiles?.department === hrDeptFilter);
  if (hrStatusFilter !== 'all') items = items.filter(r => r.status === hrStatusFilter);
  const tbody = document.getElementById('hr-requests-tbody');
  const empty = document.getElementById('hr-requests-empty');
  if (items.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  tbody.innerHTML = items.map(r => `
    <tr>
      <td class="td-name">${r.profiles?.full_name ?? '—'}</td>
      <td class="td-type">${deptLabel(r.profiles?.department)}</td>
      <td class="td-type">${r.leave_type}</td>
      <td class="td-date">${formatDate(r.start_date)} – ${formatDate(r.end_date)}</td>
      <td>${r.days}d</td>
      <td><span class="badge badge-${r.status.toLowerCase()}">${r.status}</span></td>
    </tr>`).join('');
}

function switchHRTab(tab) {
  document.querySelectorAll('.hr-tab-content').forEach(el => el.style.display = 'none');
  document.getElementById('hr-' + tab).style.display = '';
  document.querySelectorAll('#hr-view .view-tabs .view-tab').forEach((t, i) =>
    t.classList.toggle('active', ['overview', 'history'][i] === tab)
  );
}

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab-content').forEach(el => el.style.display = 'none');
  document.getElementById('admin-' + tab).style.display = '';
  document.querySelectorAll('#admin-view .view-tabs .view-tab').forEach((t, i) =>
    t.classList.toggle('active', ['requests','calendar','team'][i] === tab)
  );
  if (tab === 'calendar') renderAdminCalendar();
  if (tab === 'team')     renderTeamTable();
}

function filterRequests(btn, filter) {
  adminFilter = filter;
  document.querySelectorAll('#admin-requests .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderRequestsTable();
}

function renderRequestsTable() {
  let items = [...allRequests];
  if (adminFilter !== 'all') items = items.filter(r => r.status === adminFilter);
  const tbody = document.getElementById('requests-tbody');
  const empty = document.getElementById('requests-empty');
  if (items.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  tbody.innerHTML = items.map(r => `
    <tr>
      <td class="td-name">${r.profiles?.full_name ?? '—'}</td>
      <td class="td-type">${r.leave_type}</td>
      <td class="td-date">${formatDate(r.start_date)} – ${formatDate(r.end_date)}</td>
      <td>${r.days}d</td>
      <td><span class="badge badge-${r.status.toLowerCase()}">${r.status}</span></td>
      <td class="td-actions">
        ${r.document_path ? `<button class="btn btn-ghost btn-sm" onclick="viewDocument('${r.document_path}')">Document</button>` : ''}
        ${r.status === 'Pending' ? `
          <button class="btn btn-approve btn-sm" onclick="handleRequest(${r.id})">Approve</button>
          <button class="btn btn-reject  btn-sm" onclick="openDenyModal(${r.id})">Reject</button>
        ` : (r.status === 'Rejected' && r.rejection_reason
              ? `<span style="font-size:0.78rem;color:var(--danger)" title="${r.rejection_reason}">Reason: ${r.rejection_reason.slice(0,20)}${r.rejection_reason.length > 20 ? '…' : ''}</span>`
              : `<span style="font-size:0.8rem;color:var(--text-3)">—</span>`)}
      </td>
    </tr>`).join('');
}

async function viewDocument(path) {
  const { data, error } = await db.storage
    .from('leave-documents')
    .createSignedUrl(path, 60);
  if (error) return showToast('Could not open document: ' + error.message);
  window.open(data.signedUrl, '_blank');
}

async function handleRequest(id) {
  const req = allRequests.find(r => r.id === id);
  if (!req) return;
  const btns = document.querySelectorAll(`[onclick*="handleRequest(${id}"]`);
  btns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });
  const { error } = await db.rpc('approve_leave', { request_id: id });
  if (error) {
    showToast('Error: ' + error.message);
    btns.forEach(b => { b.disabled = false; b.style.opacity = ''; });
    return;
  }
  showToast(`✓ Approved for ${req.profiles?.full_name}`);
  await loadAdminData();
}

function openDenyModal(requestId) {
  currentDenyRequestId = requestId;
  document.getElementById('denyReasonInput').value = '';
  document.getElementById('denyReasonModal').classList.remove('hidden');
}

function closeDenyModal() {
  document.getElementById('denyReasonModal').classList.add('hidden');
  currentDenyRequestId = null;
}

async function submitDenial() {
  const reason = document.getElementById('denyReasonInput').value.trim();
  if (!reason) return showToast('Reason is required');

  const req = allRequests.find(r => r.id === currentDenyRequestId);
  const btn = document.getElementById('confirmDenyBtn');
  btn.disabled = true;

  const { error } = await db.rpc('reject_leave', {
    request_id: currentDenyRequestId,
    reason: reason
  });

  btn.disabled = false;

  if (error) return showToast('Error: ' + error.message);

  closeDenyModal();
  showToast(`✕ Rejected for ${req?.profiles?.full_name ?? 'employee'}`);
  await loadAdminData();
}

function renderTeamTable() {
  const isAdmin = currentProfile.role === 'admin';
  const scoped = currentProfile.role === 'team_lead'
    ? allProfiles.filter(p => p.department === currentProfile.department)
    : allProfiles;
  document.getElementById('team-tbody').innerHTML = scoped.map(p => {
    const used = allRequests
      .filter(r => r.user_id === p.id && r.status === 'Approved')
      .reduce((s, r) => s + r.days, 0);
    const roleCell = isAdmin
      ? `<select id="role-sel-${p.id}" class="role-select">
           ${['employee', 'team_lead', 'hr', 'admin'].map(r =>
             `<option value="${r}" ${r === p.role ? 'selected' : ''}>${roleLabel(r)}</option>`
           ).join('')}
         </select>
         <button class="btn btn-ghost btn-sm" onclick="updateRole('${p.id}')">Save</button>`
      : roleLabel(p.role);
    return `
      <tr>
        <td class="td-name">${p.full_name}</td>
        <td class="td-type">${deptLabel(p.department)}</td>
        <td>${p.annual_left} days</td>
        <td>${p.sick_left} days</td>
        <td>${used} days</td>
        <td>${roleCell}</td>
      </tr>`;
  }).join('');
}

async function updateRole(profileId) {
  const sel = document.getElementById(`role-sel-${profileId}`);
  const newRole = sel.value;
  const { error } = await db.from('profiles').update({ role: newRole }).eq('id', profileId);
  if (error) return showToast('Error: ' + error.message);
  showToast('Role updated');
  await loadAdminData();
}

function changeAdminMonth(dir) {
  adminCalMonth += dir;
  if (adminCalMonth > 11) { adminCalMonth = 0; adminCalYear++; }
  if (adminCalMonth < 0)  { adminCalMonth = 11; adminCalYear--; }
  renderAdminCalendar();
}
function renderAdminCalendar() { renderCal('admin-cal-grid', 'admin-cal-month-label', adminCalYear, adminCalMonth); }

function renderCal(gridId, labelId, year, month) {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById(labelId).textContent = `${MONTHS[month]} ${year}`;
  const grid = document.getElementById(gridId);
  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset      = (firstDay + 6) % 7;
  const approvedDates = new Set();
  const pendingDates  = new Set();
  allRequests.forEach(r => {
    const cur = new Date(r.start_date + 'T00:00:00');
    const fin = new Date(r.end_date   + 'T00:00:00');
    while (cur <= fin) {
      if (cur.getMonth() === month && cur.getFullYear() === year) {
        const key = cur.getDate();
        if (r.status === 'Approved') approvedDates.add(key);
        if (r.status === 'Pending')  pendingDates.add(key);
      }
      cur.setDate(cur.getDate() + 1);
    }
  });
  const todayD = today.getDate(), todayM = today.getMonth(), todayY = today.getFullYear();
  let html = '';
  for (let i = 0; i < offset; i++) html += '<div class="day-cell empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isPast = year < todayY || (year === todayY && month < todayM) || (year === todayY && month === todayM && d < todayD);
    const isToday = d === todayD && month === todayM && year === todayY;
    let cls = 'day-cell' + (isToday ? ' today-cell' : '');
    if (isWeekend)                 cls += ' weekend';
    else if (approvedDates.has(d)) cls += ' booked';
    else if (pendingDates.has(d))  cls += ' pending-day';
    else if (isPast)               cls += ' past';
    else                           cls += ' available';
    html += `<div class="${cls}">${d}</div>`;
  }
  grid.innerHTML = html;
}

function formatDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  const MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${parseInt(d)} ${MS[parseInt(m) - 1]}`;
}
function showAlert(id, msg) {
  const el = document.getElementById(id);
  el.classList.remove('hidden');
  el.querySelector('span:last-child').textContent = msg;
  setTimeout(() => el.classList.add('hidden'), 7000);
}
function hideAlert(id) { document.getElementById(id).classList.add('hidden'); }
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 280); }, 2800);
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (document.getElementById('login-form').style.display !== 'none') doSignIn();
  else if (document.getElementById('signup-form').style.display !== 'none') doSignUp();
});