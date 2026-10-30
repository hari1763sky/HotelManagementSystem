import { useEffect, useState } from 'react';
import { Route, Routes, useNavigate } from 'react-router-dom';
import './operations.css';
import './theme.css';
import './operations-extra.css';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Bell, CalendarDays, Check, Moon, Sun,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, ClipboardList, CreditCard,
  DoorOpen, Download, Eye, EyeOff, LayoutDashboard, LockKeyhole, LogOut, Mail, Menu,
  MoreHorizontal, Plus, Search, Settings, ShieldCheck, Sparkles, UserRound, Users, X,
} from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const money = (amount) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(amount) || 0);
async function downloadInvoicePdf(invoice) {
  const { downloadInvoicePdf: generatePdf } = await import('./invoicePdf.js');
  generatePdf(invoice).catch((pdfError) => setError(pdfError.message));
}
const ROOM_PHOTOS = [
  '/pexels-ahmetcotur-27626182.jpg',
  '/pexels-andrew-3201766.jpg',
  '/pexels-hotanphat28-38683453.jpg',
  '/pexels-jose-maria-ali-anaya-ccallocunto-2162070770-39333417.jpg',
  '/pexels-kadiravsarr-14750392.jpg',
  '/pexels-misbaa-eri-426041722-39894350.jpg',
  '/pexels-natasha-filippovskaya-2203043-11933086.jpg',
  '/pexels-quang-nguyen-vinh-222549-6876801.jpg',
  '/pexels-vince-33389169.jpg',
];

async function api(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || 'Request failed.');
  return body;
}

function Brand({ compact = false }) {
  return <div className={`brand ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-mark"><span /></span>
    <span className="brand-name">haven<span className="brand-dot">.</span></span>
    {!compact && <span className="brand-label">HOTEL MANAGEMENT</span>}
  </div>;
}

function AuthPage({ mode, setMode, setUser, setData, theme, setTheme }) {
  const isRegister = mode === 'register';
  const isBootstrap = mode === 'adminBootstrap';
  const isForgotPassword = mode === 'forgotPassword';
  const isResetPassword = mode === 'resetPassword';
  const [values, setValues] = useState({ name: '', email: '', phone: '', password: '', confirmPassword: '', setupKey: '', requestedUserType: 'customer', token: new URLSearchParams(window.location.search).get('token') || '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  function update(event) {
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function selectUserType(event) {
    const requestedUserType = event.target.value;
    if (requestedUserType !== 'admin') {
      update(event);
      return;
    }

    setError('');
    try {
      const { available } = await api('/api/auth/bootstrap-status');
      if (available) navigate('/setup-admin');
      else {
        setMode('login');
        navigate('/login');
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      if (isForgotPassword) {
        const result = await api('/api/auth/request-password-reset', { method: 'POST', body: JSON.stringify({ email: values.email }) });
        setSuccess(result.message);
        return;
      }
      if (isResetPassword) {
        if (!values.token) throw new Error('This reset link is incomplete. Request a new password reset email.');
        const result = await api('/api/auth/reset-password', { method: 'POST', body: JSON.stringify(values) });
        setSuccess(result.message);
        setValues((current) => ({ ...current, password: '', confirmPassword: '', token: '' }));
        setMode('login');
        return;
      }
      const endpoint=isBootstrap?'/api/auth/bootstrap-admin':`/api/auth/${isRegister ? 'register' : 'login'}`;
      const { user } = await api(endpoint, {
        method: 'POST', body: JSON.stringify(values),
      });
      setData(user.role === 'customer' ? { customer:true } : await api('/api/dashboard'));
      setUser(user);
      navigate('/dashboard');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return <main className="auth-page">
    <aside className="auth-showcase">
      <div className="showcase-image" />
      <div className="showcase-top"><Brand /><span className="showcase-location">EST. 2018&nbsp; · &nbsp;PACIFIC COAST</span></div>
      <div className="showcase-copy">
        <span className="eyebrow"><span className="eyebrow-line" /> A MORE CONSIDERED STAY</span>
        <h1>Hospitality,<br /><em>beautifully</em><br />in balance.</h1>
        <p>Thoughtful spaces. Seamless stays.<br />Everything in its right place.</p>
      </div>
      <div className="showcase-footer"><span>37° 48' 24.12" N &nbsp; 122° 28' 42.6" W</span><span>SCROLL TO EXPLORE <ArrowRight size={14} /></span></div>
      <div className="photo-credit">A quieter kind of luxury</div>
    </aside>

    <section className="auth-panel">
      <div className="auth-mobile-brand"><Brand /></div>
      <div className="auth-topline"><span>YOUR SPACE, WELL MANAGED.</span><div className="auth-top-actions"><button className="theme-select-compact" aria-label={`Current appearance: ${theme}. Click to cycle theme.`} onClick={()=>setTheme(theme==='light'?'dark':theme==='dark'?'system':'light')}>{theme==='dark'?<Moon size={15}/>:<Sun size={15}/>} {theme}</button><a href="#about">Need help? <CircleHelp size={15} /></a></div></div>
      <div className="auth-form-wrap">
        <div className="auth-heading-icon"><Sparkles size={18} /></div>
        <span className="eyebrow auth-eyebrow">WELCOME TO HAVEN</span>
        <h2>{isBootstrap?'Set up hotel administrator':isRegister ? 'Create your account' : isForgotPassword ? 'Forgot your password?' : isResetPassword ? 'Choose a new password' : 'Welcome back'}</h2>
        <p className="auth-subtitle">{isBootstrap?'One-time setup. Requires the deployment setup key.':isRegister ? 'A better way to run your hotel starts here.':isForgotPassword?'Enter the email address linked to your account. We’ll send a secure reset link.':isResetPassword?'Choose a new password for your Haven account.':'Sign in to pick up right where you left off.'}</p>
        <form className="auth-form" onSubmit={submit}>
          {(isRegister||isBootstrap) && <><label className="field-label">Full name<div className="input-wrap"><UserRound size={17} /><input autoComplete="name" name="name" placeholder="Your name" value={values.name} onChange={update} required minLength={2} maxLength={80} /></div></label>{isRegister&&<><label className="field-label">Phone number<div className="input-wrap"><input autoComplete="tel" name="phone" placeholder="Optional contact number" value={values.phone} onChange={update} maxLength={40}/></div></label><label className="field-label">User type<div className="input-wrap"><select name="requestedUserType" value={values.requestedUserType} onChange={selectUserType}><option value="customer">Customer / Guest</option><option value="receptionist">Receptionist</option><option value="kitchen">Cooking Team</option><option value="maintenance">Maintenance Team</option><option value="admin">Administrator</option></select></div></label><p className="registration-role-note"><strong>{['kitchen','maintenance'].includes(values.requestedUserType)?'Limited team workspace access':'Customer / Guest account'}</strong><span>{['kitchen','maintenance'].includes(values.requestedUserType)?`After registration, you’ll enter the ${values.requestedUserType==='kitchen'?'Cooking':'Maintenance'} Team workspace. Access is limited to that team’s area; room, reservation, and guest management are not available.`:'Customer and Receptionist selections continue to create a guest account, as before. Administrator access uses protected setup or existing administrator sign-in.'}</span></p></>}</>}
          {!isResetPassword && <label className="field-label">Email address<div className="input-wrap"><Mail size={17} /><input type="email" autoComplete="email" name="email" placeholder="you@yourhotel.com" value={values.email} onChange={update} required /></div></label>}
          {!isForgotPassword && <label className="field-label">{isResetPassword?'New password':'Password'}<div className="input-wrap"><LockKeyhole size={17} /><input type={showPassword ? 'text' : 'password'} autoComplete={isRegister||isBootstrap||isResetPassword ? 'new-password' : 'current-password'} name="password" placeholder={isRegister||isBootstrap||isResetPassword ? 'At least 8 characters' : 'Enter your password'} value={values.password} onChange={update} required minLength={isBootstrap?12:isRegister||isResetPassword ? 8 : 1} maxLength={72} /><button className="reveal-button" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>}
          {(isRegister||isBootstrap||isResetPassword) && <label className="field-label">Confirm password<div className="input-wrap"><LockKeyhole size={17}/><input type="password" autoComplete="new-password" name="confirmPassword" placeholder="Re-enter your password" value={values.confirmPassword} onChange={update} required minLength={isBootstrap?12:8} maxLength={72}/></div></label>}
          {isBootstrap&&<label className="field-label">Administrator setup key<div className="input-wrap"><LockKeyhole size={17}/><input type="password" name="setupKey" autoComplete="off" value={values.setupKey} onChange={update} required/></div></label>}
          {!isRegister&&!isBootstrap&&!isForgotPassword&&!isResetPassword && <div className="form-options"><label className="check-label"><input type="checkbox" /><span className="custom-check"><Check size={12} /></span> Remember me</label><button type="button" className="auth-text-button" onClick={()=>setMode('forgotPassword')}>Forgot password?</button></div>}
          {error && <div className="form-error" role="alert">{error}</div>}
          {success && <div className="auth-success" role="status">{success}</div>}
          <button className="primary-button auth-submit" type="submit" disabled={loading}>{loading ? 'Please wait…' : isBootstrap?'Initialize administrator':isRegister ? ['kitchen','maintenance'].includes(values.requestedUserType)?'Create team account':'Create guest account' : isForgotPassword?'Send reset link':isResetPassword?'Update password':'Sign in'} <ArrowRight size={17} /></button>
        </form>
        {!isForgotPassword&&!isResetPassword&&<div className="auth-divider"><span>OR</span></div>}
        <p className="switch-auth">{isRegister ? 'Already have an account?' : isBootstrap?'Administrator already set up?':isForgotPassword||isResetPassword?'Remember your password?':'New to Haven?'} <button onClick={() => { setError(''); setSuccess(''); setMode(isRegister||isBootstrap||isForgotPassword||isResetPassword ? 'login' : 'register'); }}>{isRegister||isBootstrap||isForgotPassword||isResetPassword ? 'Sign in' : 'Create an account'} <ArrowRight size={14} /></button></p>
        <div className="secure-note"><ShieldCheck size={15} /><span>Your information is encrypted and secure</span></div>
      </div>
      <div className="auth-bottom"><span>© 2026 HAVEN HOSPITALITY GROUP</span><div><a href="#privacy">PRIVACY</a><a href="#terms">TERMS</a></div></div>
    </section>
  </main>;
}

function MetricCard({ metric, index }) {
  const icons = [CreditCard, LayoutDashboard, DoorOpen, CalendarDays];
  const Icon = icons[index];
  return <article className="metric-card"><div className="metric-top"><span className={`metric-icon metric-icon-${metric.kind}`}><Icon size={17} /></span><button aria-label="Metric options"><MoreHorizontal size={19} /></button></div><p>{metric.label}</p><div className="metric-bottom"><strong>{metric.value}</strong><span className={index === 2 || index === 3 ? 'metric-neutral' : 'metric-change'}>{index === 2 || index === 3 ? <Check size={12} /> : <ArrowUpRight size={13} />}{metric.change}</span></div><div className="metric-sparkline"><span style={{ height: `${34 + index * 6}%` }} /><span style={{ height: `${49 + index * 2}%` }} /><span style={{ height: `${40 + index * 8}%` }} /><span style={{ height: `${65 - index * 3}%` }} /><span style={{ height: `${54 + index * 5}%` }} /><span style={{ height: `${75 - index * 2}%` }} /><span style={{ height: `${67 + index * 3}%` }} /><span style={{ height: `${88 - index}%` }} /></div></article>;
}

function StatusBadge({ status }) {
  const className = status.toLowerCase().replaceAll(' ', '-');
  return <span className={`status-badge status-${className}`}><span />{status}</span>;
}

function Dashboard({ user, setUser, data, setData }) {
  const [activeNav, setActiveNav] = useState('Overview');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const navigate = useNavigate();
  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    navigate('/login');
  }

  const filteredReservations = (data?.reservations || []).filter((item) => `${item.guest} ${item.room} ${item.status}`.toLowerCase().includes(query.toLowerCase()));
  const items = [
    { name: 'Overview', icon: LayoutDashboard }, { name: 'Reservations', icon: ClipboardList, badge: '8' },
    { name: 'Rooms & suites', icon: DoorOpen }, { name: 'Guests', icon: Users }, { name: 'Calendar', icon: CalendarDays },
  ];
  const sectionName = activeNav === 'Overview' ? 'Dashboard overview' : activeNav;

  async function copySection(name) {
    setActiveNav(name);
    setMobileNav(false);
    if (name !== 'Overview') {
      setNotice(`${name} view selected — showing your latest hotel data.`);
      window.setTimeout(() => setNotice(''), 3500);
    }
  }

    return <div className={`dashboard-shell ${user.role === 'finance' ? 'finance-role' : ''}`}>
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Brand /></div>
      <div className="hotel-switcher"><div className="hotel-avatar">H</div><div className="hotel-meta"><strong>The Haven House</strong><span>San Francisco, CA</span></div><ChevronDown size={16} /></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="main-nav">{items.map(({ name, icon: Icon, badge }) => <button key={name} onClick={() => copySection(name)} className={`nav-item ${activeNav === name ? 'nav-active' : ''}`}><Icon size={18} /><span>{name}</span>{badge && <small>{badge}</small>}</button>)}</nav>
      <div className="nav-caption nav-caption-tools">MANAGE</div>
      <nav className="main-nav"><button className="nav-item" onClick={() => copySection('Reports')}><CreditCard size={18} /><span>Reports & finance</span></button><button className="nav-item" onClick={() => copySection('Settings')}><Settings size={18} /><span>Settings</span></button></nav>
      <div className="sidebar-spacer" />
      <div className="help-card"><div className="help-icon"><CircleHelp size={17} /></div><strong>Need a hand?</strong><p>Our team is here when you need us.</p><button onClick={() => setNotice('Support request started — our team will be in touch.')}>Visit help center <ArrowRight size={14} /></button></div>
      <button className="profile-row" onClick={logout}><div className="profile-avatar">{user.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div><div className="profile-meta"><strong>{user.name}</strong><span>{user.role === 'admin' ? 'Hotel administrator' : 'Hotel staff'}</span></div><LogOut size={16} /></button>
    </aside>
    {mobileNav && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <main className="dashboard-main">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={21} /></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14} /><strong>{sectionName}</strong></div><div className="topbar-actions"><div className="date-chip"><CalendarDays size={15} /> Tuesday, October 27, 2026</div><button className="icon-button" aria-label="Search"><Search size={18} /></button><button className="icon-button notification-button" aria-label="Notifications"><Bell size={18} /><i /></button><div className="topbar-divider" /><div className="topbar-profile"><div className="profile-avatar">{user.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div><ChevronDown size={15} /></div></div></header>
      <div className="dashboard-content">
        {notice && <div className="notice-banner"><Check size={15} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}
        <section className="welcome-row"><div><div className="eyebrow dashboard-eyebrow"><span className="live-dot" /> TUESDAY, OCTOBER 27, 2026 <span className="welcome-divider">/</span> GOOD MORNING</div><h1>{activeNav === 'Overview' ? <>A lovely day to host, <em>{user.name.split(' ')[0]}.</em></> : <>{activeNav}, <em>at a glance.</em></>}</h1><p>Here’s what’s happening at The Haven House today.</p></div><button className="primary-button report-button" onClick={() => setNotice('Your daily report is ready to review.')}><ArrowDownRight size={16} /> Download report</button></section>
        <section className="metric-grid">{(data?.metrics || []).map((metric, index) => <MetricCard key={metric.label} metric={metric} index={index} />)}</section>
        <section className="dashboard-grid">
          <article className="panel reservation-panel"><div className="panel-heading"><div><span className="panel-kicker">THE FRONT DESK</span><h2>Today’s arrivals <span className="count-pill">{filteredReservations.filter((item) => item.status === 'Arriving').length} expected</span></h2></div><button className="text-action" onClick={() => copySection('Reservations')}>View all <ArrowRight size={15} /></button></div><div className="table-toolbar"><div className="table-search"><Search size={15} /><input placeholder="Find a guest or room..." value={query} onChange={(event) => setQuery(event.target.value)} /></div><button className="filter-button" onClick={() => setNotice('Showing all reservation statuses.')}><span className="filter-lines">☷</span> Filters</button></div><div className="table-scroll"><table><thead><tr><th>GUEST</th><th>ROOM</th><th>STAY</th><th>STATUS</th><th aria-label="Actions" /></tr></thead><tbody>{filteredReservations.map((reservation) => <tr key={reservation.id}><td><div className="guest-cell"><span className={`guest-avatar guest-${reservation.id}`}>{reservation.guest.split(' ').map((part) => part[0]).join('')}</span><span><strong>{reservation.guest}</strong><small>{reservation.email}</small></span></div></td><td><span className="room-number">{reservation.room}</span></td><td><strong className="stay-date">{reservation.checkIn.slice(5).replace('-', '/')} <span>—</span> {reservation.checkOut.slice(5).replace('-', '/')}</strong><small className="stay-length">{Math.max(1, Math.round((new Date(reservation.checkOut) - new Date(reservation.checkIn)) / 86400000))} nights</small></td><td><StatusBadge status={reservation.status} /></td><td><button className="row-more" aria-label={`More for ${reservation.guest}`} onClick={() => setNotice(`Reservation for ${reservation.guest} opened.`)}><MoreHorizontal size={18} /></button></td></tr>)}</tbody></table>{filteredReservations.length === 0 && <div className="empty-results">No guests match “{query}”.</div>}</div><div className="table-footer"><span>Showing <strong>{filteredReservations.length}</strong> of <strong>{data?.reservations?.length || 0}</strong> reservations</span><div><button aria-label="Previous page"><ChevronLeft size={16} /></button><button className="page-current">1</button><button aria-label="Next page"><ChevronRight size={16} /></button></div></div></article>
          <aside className="right-stack"><article className="panel occupancy-panel"><div className="panel-heading"><div><span className="panel-kicker">ROOMS AT A GLANCE</span><h2>Occupancy</h2></div><button className="panel-more" aria-label="More occupancy options"><MoreHorizontal size={19} /></button></div><div className="occupancy-content"><div className="occupancy-ring"><div><strong>{data?.metrics?.[1]?.value || '0%'}</strong><span>occupied</span></div></div><div className="occupancy-legend">{(data?.roomSummary || []).map((item) => <div key={item.status}><span className={`legend-dot legend-${item.status.toLowerCase()}`} /><span>{item.status}</span><strong>{String(item.count).padStart(2, '0')}</strong></div>)}</div></div><button className="panel-bottom-link" onClick={() => copySection('Rooms & suites')}>Explore all rooms <ArrowRight size={15} /></button></article><article className="panel activity-panel"><div className="panel-heading"><div><span className="panel-kicker">THE LITTLE THINGS</span><h2>Today’s rhythm</h2></div><button className="panel-more" aria-label="More activity options"><MoreHorizontal size={19} /></button></div><div className="activity-list"><div className="activity-item"><span className="activity-icon activity-arrival"><ArrowRight size={15} /></span><div><strong>New guest arrival</strong><p>Sofia Martinez · Room 103</p></div><time>10:42</time></div><div className="activity-item"><span className="activity-icon activity-checkout"><Check size={15} /></span><div><strong>Room turned over</strong><p>Room 208 is ready for a guest</p></div><time>10:18</time></div><div className="activity-item"><span className="activity-icon activity-booking"><CalendarDays size={15} /></span><div><strong>New reservation</strong><p>2 nights · Garden Suite</p></div><time>09:36</time></div></div><button className="panel-bottom-link" onClick={() => setNotice('You’re all caught up on today’s activity.')}>See all activity <ArrowRight size={15} /></button></article></aside>
        </section>
        <footer className="dashboard-footer"><span>MADE FOR MOMENTS THAT MATTER <span>✳</span></span><span>HAVEN HOTEL MANAGEMENT <b>·</b> V 1.0</span></footer>
      </div>
    </main>
  </div>;
}

function OperationsDashboard({ user, setUser, data, setData, theme, setTheme }) {
  const [activeNav, setActiveNav] = useState(()=>({housekeeping:'Housekeeping',maintenance:'Maintenance',kitchen:'Kitchen'}[user.role]||'Overview'));
  const [records, setRecords] = useState([]);
  const [moduleData, setModuleData] = useState(null);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [form, setForm] = useState(null);
  const [range, setRange] = useState({ from: new Date().toISOString().slice(0, 10), to: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) });
  const [history, setHistory] = useState(null);
  const navigate = useNavigate();
  const canManageRooms = ['admin', 'manager'].includes(user.role);
  const isAdmin = user.role === 'admin';
  const today = new Date().toISOString().slice(0, 10);
  const navItems = [
    { name: 'Overview', icon: LayoutDashboard }, { name: 'Reservations', icon: ClipboardList },
    { name: 'Rooms & suites', icon: DoorOpen }, { name: 'Guests', icon: Users },
    { name: 'Calendar', icon: CalendarDays }, { name: 'Reports & finance', icon: CreditCard },
    { name: 'Notifications', icon: Bell }, { name: 'Settings', icon: Settings },
    { name: 'Housekeeping', icon: Sparkles }, { name: 'Maintenance', icon: Settings }, { name: 'Kitchen', icon: CreditCard },
    { name: 'Staff & audit', icon: ShieldCheck }, { name: 'Operations', icon: Sparkles },
  ];
  const roleNavigation={
    admin:navItems.map((item)=>item.name),
    manager:['Overview','Reservations','Rooms & suites','Guests','Calendar','Reports & finance','Notifications','Settings','Housekeeping','Maintenance','Kitchen','Operations'],
    receptionist:['Overview','Reservations','Rooms & suites','Guests','Calendar','Notifications'],
    finance:['Overview','Reports & finance','Notifications'],
    housekeeping:['Housekeeping','Notifications'],maintenance:['Maintenance','Notifications'],kitchen:['Kitchen','Notifications'],
  };
  const visibleNavItems=navItems.filter((item)=>(roleNavigation[user.role]||[]).includes(item.name));

  async function loadSection(section = activeNav, dates = range) {
    if (section === 'Overview') { setModuleData(null); return; }
    try {
      let payload;
      if (section === 'Reservations') payload = await api('/api/reservations');
      else if (section === 'Rooms & suites') payload = await api('/api/rooms');
      else if (section === 'Guests') payload = await api(`/api/guests?search=${encodeURIComponent(query)}`);
      else if (section === 'Calendar') payload = await api(`/api/calendar?from=${dates.from}&to=${dates.to}`);
      else if (section === 'Reports & finance') {
        const [report, payments, expenses, refunds, guests] = await Promise.all([api(`/api/reports?from=${dates.from}&to=${dates.to}`), api('/api/payments'),api('/api/expenses'),api('/api/refunds'),api('/api/guest-financial-summaries')]);
        payload = { ...report, allPayments: payments.payments, expenses:expenses.expenses, refunds:refunds.refunds, guestSummaries:guests.summaries };
      } else if (section === 'Settings') payload = await api('/api/settings');
      else if (section === 'Notifications') payload = await api('/api/notifications');
      else if (section === 'Housekeeping') payload = await api('/api/housekeeping/tasks');
      else if (section === 'Maintenance') payload = await api('/api/maintenance/requests');
      else if (section === 'Kitchen') payload = await api('/api/kitchen/orders');
      else if (section === 'Staff & audit') {const [staff,logs]=await Promise.all([api('/api/staff'),api('/api/audit-logs')]);payload={staff:staff.staff,logs:logs.logs};}
      else if (section === 'Operations') {const [queues,guestRequests,reservations]=await Promise.all([api('/api/operations/queues'),api('/api/guest-requests'),api('/api/reservations')]);payload={...queues,guestRequests:guestRequests.requests,reservations:reservations.reservations};}
      setModuleData(payload);
      setRecords(payload?.reservations || payload?.rooms || payload?.guests || payload?.payments || payload?.notifications || payload?.tasks || payload?.requests || payload?.orders || payload?.staff || []);
    } catch (requestError) { setError(requestError.message); }
  }

  useEffect(() => { loadSection(activeNav); }, [activeNav]);
  async function refresh() {
    const fresh = await api('/api/dashboard');
    setData(fresh);
    await loadSection(activeNav);
  }
  async function chooseSection(name) {
    setActiveNav(name); setQuery(''); setHistory(null); setMobileNav(false); setError('');
    await loadSection(name);
  }
  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null); navigate('/login');
  }
  function notify(message) { setNotice(message); window.setTimeout(() => setNotice(''), 4000); }
  function startForm(kind, item = null) {
    setError('');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    if (kind === 'reservation') setForm({ kind, item, values: item ? { guestName:item.guest,email:item.email,phone:item.phone || '',roomId:item.roomId,checkIn:item.checkIn,checkOut:item.checkOut } : { guestName:'',email:'',phone:'',roomId:'',checkIn:today,checkOut:tomorrow,status:'Pending',additionalCharges:0,taxes:0,discount:0 } });
    else if (kind === 'room') setForm({ kind,item,values:item ? { number:item.number,type:item.type,rate:item.rate,capacity:item.capacity,floor:item.floor,status:item.status } : { number:'',type:'Deluxe King',rate:289,capacity:2,floor:1,status:'Available' } });
    else if (kind === 'guest') setForm({ kind,item,values:item ? { name:item.name,email:item.email,phone:item.phone || '',idDetails:item.idDetails || '',preferences:item.preferences || '' } : { name:'',email:'',phone:'',idDetails:'',preferences:'' } });
    else if (kind === 'payment') setForm({ kind,item,values:{ reservationId:item.id,amount:Math.max(0,item.amount-item.paid),method:'Card',reference:'' } });
    else if (kind === 'staff') setForm({kind,item:null,values:{name:'',email:'',phone:'',password:'',role:'receptionist',employeeId:'',department:''}});
    else if (kind === 'expense') setForm({kind,item:null,values:{category:'Supplies',description:'',amount:'',expenseDate:today,reference:''}});
    else if (kind === 'refund') setForm({kind,item,values:{paymentId:item.id,amount:item.amount,reason:''}});
    else if (kind === 'housekeeping') setForm({kind,item:null,values:{roomId:'',assignedTo:'',priority:'Normal',instructions:'',dueDate:today}});
    else if (kind === 'maintenance') setForm({kind,item:null,values:{roomId:'',issue:'',priority:'Normal',instructions:''}});
    else if (kind === 'settings') setForm({ kind,item:null,values:{...moduleData.hotel} });
  }
  function setField(event) { setForm((current) => ({ ...current, values:{ ...current.values, [event.target.name]:event.target.value } })); }
  useEffect(() => {
    if (form?.kind !== 'reservation' || !form.values.checkIn || !form.values.checkOut || form.values.checkIn >= form.values.checkOut) return;
    api(`/api/rooms?checkIn=${form.values.checkIn}&checkOut=${form.values.checkOut}`)
      .then(({ rooms }) => setAvailableRooms(rooms.filter((room) => room.availableForDates || room.id === form.values.roomId)))
      .catch((requestError) => setError(requestError.message));
  }, [form?.kind, form?.values.checkIn, form?.values.checkOut, form?.values.roomId]);
  async function saveForm(event) {
    event.preventDefault(); setError('');
    try {
      const { kind,item,values } = form;
      if (kind === 'reservation') {
        const payload = item ? { guestName:values.guestName,email:values.email,phone:values.phone,roomId:Number(values.roomId),checkIn:values.checkIn,checkOut:values.checkOut } : { ...values,roomId:Number(values.roomId),additionalCharges:Number(values.additionalCharges),taxes:values.taxes===''?undefined:Number(values.taxes),discount:Number(values.discount) };
        await api(item ? `/api/reservations/${item.id}` : '/api/reservations',{ method:item ? 'PATCH':'POST',body:JSON.stringify(payload) });
      } else if (kind === 'room') {
        const payload={...values,rate:Number(values.rate),capacity:Number(values.capacity),floor:Number(values.floor)};
        await api(item ? `/api/rooms/${item.id}`:'/api/rooms',{method:item?'PATCH':'POST',body:JSON.stringify(payload)});
      } else if (kind === 'guest') {
        await api(item ? `/api/guests/${item.id}`:'/api/guests',{method:item?'PATCH':'POST',body:JSON.stringify(values)});
      } else if (kind === 'payment') {
        await api(`/api/reservations/${values.reservationId}/payments`,{method:'POST',body:JSON.stringify({...values,amount:Number(values.amount)})});
      } else if (kind === 'settings') {
        await api('/api/settings',{method:'PATCH',body:JSON.stringify({...values,taxRate:Number(values.taxRate)})});
      } else if (kind === 'profile') {
        const { user: updatedUser } = await api('/api/auth/account',{method:'PATCH',body:JSON.stringify(values)});
        setUser(updatedUser);
      } else if (kind === 'staff') {
        await api('/api/staff',{method:'POST',body:JSON.stringify(values)});
      } else if (kind === 'expense') {
        await api('/api/expenses',{method:'POST',body:JSON.stringify({...values,amount:Number(values.amount)})});
      } else if (kind === 'refund') {
        await api('/api/refunds',{method:'POST',body:JSON.stringify({...values,paymentId:Number(values.paymentId),amount:Number(values.amount)})});
      } else if (kind === 'housekeeping') {
        await api('/api/housekeeping/tasks',{method:'POST',body:JSON.stringify({...values,roomId:Number(values.roomId),assignedTo:values.assignedTo?Number(values.assignedTo):undefined})});
      } else if (kind === 'maintenance') {
        await api('/api/maintenance/requests',{method:'POST',body:JSON.stringify({...values,roomId:Number(values.roomId)})});
      }
      setForm(null); notify(kind === 'payment' ? 'Payment recorded successfully.' : 'Changes saved successfully.'); await refresh();
    } catch (requestError) { setError(requestError.message); }
  }
  async function updateReservation(id, patch, success) {
    try { await api(`/api/reservations/${id}`,{method:'PATCH',body:JSON.stringify(patch)}); notify(success); await refresh(); }
    catch (requestError) { setError(requestError.message); }
  }
  async function updateRoom(id, status) {
    const room=records.find((item)=>item.id===id);
    try { await api(`/api/rooms/${id}`,{method:'PATCH',body:JSON.stringify({...room,status})}); notify(`Room ${room.number} updated.`); await refresh(); }
    catch (requestError) { setError(requestError.message); }
  }
  async function updateRole(id, role, accountStatus) {
    try { await api(`/api/settings/users/${id}`,{method:'PATCH',body:JSON.stringify({role,accountStatus})}); notify('User permissions updated.'); await loadSection(activeNav); }
    catch (requestError) { setError(requestError.message); }
  }
  async function deleteRoom(room) {
    if (!window.confirm(`Permanently delete room ${room.number}? Rooms with booking history cannot be deleted.`)) return;
    try { await api(`/api/rooms/${room.id}`,{method:'DELETE'}); notify(`Room ${room.number} deleted.`); await refresh(); }
    catch (requestError) { setError(requestError.message); }
  }
  async function markRead(item) {
    try { await api(`/api/notifications/${item.id}/read`,{method:'PATCH'}); await loadSection('Notifications'); }
    catch (requestError) { setError(requestError.message); }
  }
  async function showHistory(id) {
    try { setHistory(await api(`/api/guests/${id}/history`)); }
    catch (requestError) { setError(requestError.message); }
  }
  async function changeRange(field,value) {
    const next={...range,[field]:value};setRange(next);
    if(next.from&&next.to&&next.from<=next.to) await loadSection(activeNav,next);
  }
  async function setQuickRange(kind) {
    const now=new Date();let from=new Date(now);
    if(kind==='week'){const day=(now.getDay()+6)%7;from.setDate(now.getDate()-day);}
    else if(kind==='month')from=new Date(now.getFullYear(),now.getMonth(),1);
    else if(kind==='year')from=new Date(now.getFullYear(),0,1);
    const next={from:from.toISOString().slice(0,10),to:now.toISOString().slice(0,10)};setRange(next);await loadSection(activeNav,next);
  }
  function exportReport() {
    const rows=[['Paid at','Guest','Room','Method','Status','Amount (INR)'],...(moduleData?.payments||[]).map((p)=>[p.paidAt,p.guest,p.room,p.method,p.status,p.amount])];
    const csv=rows.map((row)=>row.map((value)=>`"${String(value??'').replaceAll('"','""')}"`).join(',')).join('\n');
    const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));link.download=`haven-finance-${range.from}-${range.to}.csv`;link.click();URL.revokeObjectURL(link.href);
  }
  const filtered=records.filter((item)=>JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
  const moduleTitle=activeNav==='Overview'?'Dashboard overview':activeNav;
  const greeting=new Date().getHours()<12?'GOOD MORNING':new Date().getHours()<18?'GOOD AFTERNOON':'GOOD EVENING';
  const metricIcons=[CreditCard,LayoutDashboard,DoorOpen,CalendarDays];

  return <div className={`dashboard-shell ${user.role==='finance'?'finance-role':''}`}>
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><Brand /></div>
      <div className="hotel-switcher"><div className="hotel-avatar">H</div><div className="hotel-meta"><strong>{moduleData?.hotel?.name || 'The Haven House'}</strong><span>{moduleData?.hotel?.address || 'Hotel operations'}</span></div><ChevronDown size={16}/></div>
      <div className="nav-caption">WORKSPACE</div><nav className="main-nav">{visibleNavItems.slice(0,5).map(({name,icon:Icon})=><button key={name} onClick={()=>chooseSection(name)} className={`nav-item ${activeNav===name?'nav-active':''}`}><Icon size={18}/><span>{name}</span></button>)}</nav>
      {visibleNavItems.length>5&&<><div className="nav-caption nav-caption-tools">MANAGE</div><nav className="main-nav">{visibleNavItems.slice(5).map(({name,icon:Icon})=><button key={name} onClick={()=>chooseSection(name)} className={`nav-item ${activeNav===name?'nav-active':''}`}><Icon size={18}/><span>{name}</span>{name==='Notifications'&&data?.notifications?.length>0&&<small>{data.notifications.length}</small>}</button>)}</nav></>}
      <div className="sidebar-spacer"/><div className="help-card"><div className="help-icon"><CircleHelp size={17}/></div><strong>Role-based workspace</strong><p>Your access: {user.role}. Ask an administrator to update permissions.</p></div>
      <button className="profile-row" onClick={logout}><div className="profile-avatar">{user.name.split(' ').map((part)=>part[0]).slice(0,2).join('').toUpperCase()}</div><div className="profile-meta"><strong>{user.name}</strong><span>{user.role}</span></div><LogOut size={16}/></button>
    </aside>
    {mobileNav&&<button className="sidebar-scrim" aria-label="Close navigation" onClick={()=>setMobileNav(false)}/>}
    <main className="dashboard-main">
        <header className="topbar"><button className="mobile-menu" onClick={()=>setMobileNav(true)} aria-label="Open menu"><Menu size={21}/></button><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14}/><strong>{moduleTitle}</strong></div><div className="topbar-actions"><div className="date-chip"><CalendarDays size={15}/>{new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</div><button className="theme-toggle" aria-label={`Switch appearance. Current setting: ${theme}.`} title={`Appearance: ${theme}`} onClick={()=>setTheme(theme==='light'?'dark':theme==='dark'?'system':'light')}>{theme==='dark'?<Moon size={17}/>:<Sun size={17}/>}</button><button className="icon-button notification-button" aria-label="Refresh data" onClick={()=>refresh()}><ArrowUpRight size={18}/></button><div className="topbar-divider"/><div className="topbar-profile"><div className="profile-avatar">{user.name.split(' ').map((part)=>part[0]).slice(0,2).join('').toUpperCase()}</div><ChevronDown size={15}/></div></div></header>
      <div className="dashboard-content">
        {notice&&<div className="notice-banner"><Check size={15}/>{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}
        {error&&<div className="form-error global-error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Dismiss">×</button></div>}
        <section className="welcome-row"><div><div className="eyebrow dashboard-eyebrow"><span className="live-dot"/>{new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'}).toUpperCase()} <span className="welcome-divider">/</span> {greeting}</div><h1>{activeNav==='Overview'?<>A lovely day to host, <em>{user.name.split(' ')[0]}.</em></> : <>{activeNav}, <em>at a glance.</em></>}</h1><p>Live operational data for {moduleData?.hotel?.name||'your hotel'}.</p></div>{['Reservations','Rooms & suites','Guests'].includes(activeNav)&&<button className="primary-button report-button" onClick={()=>startForm(activeNav==='Reservations'?'reservation':activeNav==='Rooms & suites'?'room':'guest')}><Plus size={16}/>Add {activeNav==='Reservations'?'reservation':activeNav==='Rooms & suites'?'room':'guest'}</button>}{activeNav==='Reports & finance'&&<button className="primary-button report-button" onClick={exportReport}><Download size={15}/>Export CSV</button>}</section>

        {activeNav==='Overview'&&<>
          <section className="metric-grid">{(data?.metrics||[]).map((metric,index)=>{const Icon=metricIcons[index]||CreditCard;return <article className="metric-card" key={metric.label}><div className="metric-top"><span className={`metric-icon metric-icon-${metric.kind}`}><Icon size={17}/></span><button aria-label="Refresh metrics" onClick={refresh}><MoreHorizontal size={19}/></button></div><p>{metric.label}</p><div className="metric-bottom"><strong>{metric.value}</strong><span className="metric-neutral"><Check size={12}/>{index===0?'Period totals':index===1?`${data?.stats?.occupied||0} occupied`:index===2?'Date-based':`${data?.stats?.departures||0} departures`}</span></div></article>})}</section>
          <section className="ops-stat-grid">{[['Arrivals',data?.stats?.arrivals],['Departures',data?.stats?.departures],['Currently checked in',data?.stats?.checkedIn],['Overdue check-outs',data?.stats?.overdue],['Pending reservations',data?.stats?.pending]].map(([label,count])=><article key={label}><span>{label}</span><strong>{count||0}</strong></article>)}</section>
          <section className="dashboard-grid"><article className="panel reservation-panel"><div className="panel-heading"><div><span className="panel-kicker">THE FRONT DESK</span><h2>Today’s arrivals <span className="count-pill">{data?.arrivals?.length||0} expected</span></h2></div><button className="text-action" onClick={()=>copySection('Reservations')}>View reservations <ArrowRight size={15}/></button></div><div className="table-scroll"><table><thead><tr><th>GUEST</th><th>ROOM</th><th>CHECK-IN</th><th>STATUS</th></tr></thead><tbody>{(data?.arrivals||[]).map((r)=><tr key={r.id}><td><div className="guest-cell"><span className="guest-avatar">{r.guest.split(' ').map((p)=>p[0]).join('')}</span><span><strong>{r.guest}</strong><small>{r.email}</small></span></div></td><td>{r.room}</td><td>{r.checkIn}</td><td><StatusBadge status={r.status}/></td></tr>)}</tbody></table>{!data?.arrivals?.length&&<div className="empty-results">No confirmed arrivals scheduled today.</div>}</div><button className="panel-bottom-link" onClick={()=>startForm('reservation')}>Create reservation <Plus size={15}/></button></article><aside className="right-stack"><article className="panel occupancy-panel"><div className="panel-heading"><div><span className="panel-kicker">LIVE INVENTORY</span><h2>Room status</h2></div></div><div className="occupancy-content"><div className="occupancy-ring" style={{background:`conic-gradient(#61846b 0% ${data?.metrics?.[1]?.raw||0}%,#e8eee8 ${data?.metrics?.[1]?.raw||0}% 100%)`}}><div><strong>{data?.metrics?.[1]?.value||'0%'}</strong><span>occupied</span></div></div><div className="occupancy-legend">{(data?.roomSummary||[]).map((item)=><div key={item.status}><span className={`legend-dot legend-${item.status.toLowerCase()}`}/><span>{item.status}</span><strong>{String(item.count).padStart(2,'0')}</strong></div>)}</div></div><button className="panel-bottom-link" onClick={()=>chooseSection('Rooms & suites')}>Explore room inventory <ArrowRight size={15}/></button></article><article className="panel activity-panel"><div className="panel-heading"><div><span className="panel-kicker">UPCOMING OPERATIONS</span><h2>Today’s departures</h2></div></div><div className="activity-list">{(data?.departures||[]).slice(0,4).map((item)=><div className="activity-item" key={item.id}><span className="activity-icon activity-checkout"><Check size={15}/></span><div><strong>{item.guest} · Room {item.room}</strong><p>Balance ${Math.max(0,item.amount-item.paid).toLocaleString()}</p></div></div>)}{!data?.departures?.length&&<p className="empty-results">No checked-in departures today.</p>}</div><button className="panel-bottom-link" onClick={()=>chooseSection('Reservations')}>Manage reservations <ArrowRight size={15}/></button></article></aside>
        </section>
        </>}

        {activeNav==='Reservations'&&<section className="panel data-panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">BOOKING LIFECYCLE</span><h2>Reservations</h2></div>
            <div className="table-search"><Search size={15}/><input placeholder="Search guest, room, status…" value={query} onChange={(event) => setQuery(event.target.value)}/></div>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>GUEST</th><th>ROOM</th><th>DATES</th><th>TOTAL / PAID</th><th>STATUS</th>{user.role !== 'receptionist' && <th>ACTIONS</th>}</tr></thead>
              <tbody>{filtered.map((reservation) => (
                <tr key={reservation.id}>
                  <td><strong>{reservation.guest}</strong><small className="table-sub">{reservation.email}{reservation.cancellationRequestedAt && <b className="cancellation-flag">Cancellation requested</b>}</small></td>
                  <td>{reservation.room} · {reservation.roomType}</td>
                  <td>{reservation.checkIn} — {reservation.checkOut}</td>
                  <td>{money(reservation.amount)} / {money(reservation.paid)}</td>
                  <td><StatusBadge status={reservation.status}/></td>
                  {user.role !== 'receptionist' ? (
                    <td><div className="row-actions">
                      {reservation.status === 'Pending' && <button onClick={() => updateReservation(reservation.id, {status:'Confirmed'}, 'Reservation confirmed.')}>Confirm</button>}
                      {reservation.status === 'Confirmed' && <button onClick={() => updateReservation(reservation.id, {status:'Checked-in'}, 'Guest checked in.')}>Check in</button>}
                      {reservation.status === 'Checked-in' && <button onClick={() => updateReservation(reservation.id, {status:'Checked-out'}, 'Guest checked out.')}>Check out</button>}
                      {!['Cancelled','Checked-out'].includes(reservation.status) && ['admin','manager','finance','receptionist'].includes(user.role) && <button onClick={() => startForm('payment', reservation)}>Payment</button>}
                      {['Pending','Confirmed'].includes(reservation.status) && <button className="action-muted" onClick={() => updateReservation(reservation.id, {status:'Cancelled'}, 'Reservation cancelled.')}>{reservation.cancellationRequestedAt ? 'Approve cancellation' : 'Cancel'}</button>}
                      {['admin','manager','receptionist'].includes(user.role) && <button className="action-muted" onClick={() => startForm('reservation', reservation)}>Edit</button>}
                    </div></td>
                  ) : null}
                </tr>
              ))}</tbody>
            </table>
            {!filtered.length && <div className="empty-results">No reservations found.</div>}
          </div>
        </section>}
        {activeNav==='Rooms & suites'&&<section className="panel data-panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">ROOM INVENTORY</span><h2>Rooms & suites</h2></div>
            <div className="table-search"><Search size={15}/><input placeholder="Search room or type…" value={query} onChange={(e)=>setQuery(e.target.value)}/></div>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>ROOM</th><th>TYPE</th><th>FLOOR</th><th>CAPACITY</th><th>RATE / NIGHT</th><th>STATUS</th><th>OPERATIONS</th></tr></thead>
              <tbody>{filtered.map((room)=><tr key={room.id}><td><strong>{room.number}</strong></td><td>{room.type}</td><td>{room.floor}</td><td>{room.capacity} guests</td><td>{money(room.rate)}</td><td><StatusBadge status={room.status}/></td><td><div className="row-actions">{canManageRooms&&<><select aria-label={`Set room ${room.number} status`} value={room.status} onChange={(e)=>updateRoom(room.id,e.target.value)}>{room.status==='Occupied'&&<option disabled>Occupied</option>}<option>Available</option><option>Cleaning</option><option>Maintenance</option></select><button onClick={()=>startForm('room',room)}>Edit</button></>}</div></td></tr>)}</tbody></table>{!filtered.length&&<div className="empty-results">No rooms found.</div>}</div>{!canManageRooms&&<div className="permission-note">Room inventory changes require manager or administrator access.</div>}</section>}
        {activeNav==='Guests'&&<section className="panel data-panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">GUEST RELATIONSHIPS</span><h2>Guests</h2></div>
            <div className="table-search"><Search size={15}/><input placeholder="Search name or contact…" value={query} onChange={(e)=>{setQuery(e.target.value);api(`/api/guests?search=${encodeURIComponent(e.target.value)}`).then((payload)=>{setModuleData(payload);setRecords(payload.guests)}).catch((err)=>setError(err.message));}}/></div>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>GUEST</th><th>CONTACT</th><th>STAYS</th><th>LAST STAY</th><th>PREFERENCES</th><th>PROFILE</th></tr></thead>
              <tbody>{filtered.map((guest)=><tr key={guest.id}><td><strong>{guest.name}</strong></td><td>{guest.email}<small className="table-sub">{guest.phone||'No phone on file'}</small></td><td>{guest.reservationCount}</td><td>{guest.lastStay||'—'}</td><td>{guest.preferences||'—'}</td><td><div className="row-actions"><button onClick={()=>showHistory(guest.id)}>History</button><button onClick={()=>startForm('guest',guest)}>Edit</button></div></td></tr>)}</tbody></table>{!filtered.length&&<div className="empty-results">No guests found.</div>}</div>{history&&<div className="history-panel"><button className="modal-close" onClick={()=>setHistory(null)} aria-label="Close history"><X size={17}/></button><strong>Stay history · {history.guest.name}</strong><p>{history.reservations.length?history.reservations.map((r)=>`${r.checkIn}–${r.checkOut} · room ${r.room} · ${r.status}`).join(' | '):'No reservations on record yet.'}</p></div>}</section>}
        {activeNav==='Calendar'&&<section className="panel data-panel">
          <div className="panel-heading">
            <div><span className="panel-kicker">ROOM SCHEDULE</span><h2>Reservation calendar</h2></div>
            <div className="range-controls"><label>From<input type="date" value={range.from} onChange={(e)=>changeRange('from',e.target.value)}/></label><label>To<input type="date" value={range.to} onChange={(e)=>changeRange('to',e.target.value)}/></label></div>
          </div>
          <div className="calendar-list">{(moduleData?.reservations||[]).map((r)=><article key={r.id} className="calendar-entry"><div className="calendar-date"><strong>{new Date(`${r.checkIn}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</strong><span>to {new Date(`${r.checkOut}T00:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</span></div><div><strong>{r.guest}</strong><p>Room {r.room} · {r.roomType} · {money(r.amount)} · {Math.max(1,Math.round((new Date(r.checkOut)-new Date(r.checkIn))/86400000))} nights</p></div><StatusBadge status={r.status}/></article>)}{!moduleData?.reservations?.length&&<div className="empty-results">No bookings in this date range.</div>}</div></section>}
        {activeNav==='Reports & finance'&&<>
          <section className="panel data-panel finance-panel">
            <div className="panel-heading"><div><span className="panel-kicker">ACCOUNTING PERIOD</span><h2>Finance & reports</h2></div><div className="range-controls"><label>From<input type="date" value={range.from} onChange={(e)=>changeRange('from',e.target.value)}/></label><label>To<input type="date" value={range.to} onChange={(e)=>changeRange('to',e.target.value)}/></label></div></div>
            <div className="quick-ranges">{[['today','Today'],['week','This week'],['month','This month'],['year','This year']].map(([key,label])=><button key={key} onClick={()=>setQuickRange(key)}>{label}</button>)}<button className="primary-button" onClick={()=>startForm('expense')}><Plus size={14}/>Record expense</button><button className="primary-button" onClick={exportReport}><Download size={14}/>Export CSV</button><button className="primary-button" onClick={()=>window.print()}>Print / Save PDF</button></div>
            <div className="finance-summary"><article><span>Gross booking charges</span><strong>{money(Number(moduleData?.grossCharges||0))}</strong></article><article><span>Net recognized revenue</span><strong>{money(Number(moduleData?.recognizedRevenue||0))}</strong></article><article><span>Successful payments</span><strong>{money(Number(moduleData?.received||0))}</strong></article><article><span>Refunds issued</span><strong>{money(Number(moduleData?.refunds||0))}</strong></article><article><span>Net cash collected</span><strong>{money(Number(moduleData?.netCash||0))}</strong></article><article><span>Outstanding receivables</span><strong>{money(Number(moduleData?.outstanding||0))}</strong></article><article><span>Approved expenses</span><strong>{money(Number(moduleData?.expenses||0))}</strong></article><article><span>Net operating result*</span><strong>{money(Number(moduleData?.netOperatingResult||0))}</strong></article><article><span>Payment transactions</span><strong>{moduleData?.transactions||0}</strong></article></div>
            <div className="finance-breakdowns"><article><strong>Payment status by booking</strong><p>{(moduleData?.paymentStatusCounts||[]).map((item)=>`${item.status.replace('_',' ')}: ${item.count}`).join(' · ')||'No bookings in this period'}</p></article><article><strong>Successful payments by method</strong><p>{(moduleData?.paymentBreakdown||[]).map((item)=>`${item.method}: ${money(item.total)} (${item.count})`).join(' · ')||'No payments in this period'}</p></article><small>*Operational cash convention: successful payments minus completed refunds, minus approved expenses. Taxes and booking charges are displayed separately.</small></div>
            <div className="panel-heading finance-subheading"><div><span className="panel-kicker">TRANSACTION HISTORY</span><h2>Payments</h2></div></div><div className="table-scroll"><table><thead><tr><th>DATE</th><th>GUEST</th><th>ROOM</th><th>METHOD</th><th>STATUS</th><th>AMOUNT</th><th>ACTION</th></tr></thead><tbody>{(moduleData?.payments||[]).map((payment)=><tr key={payment.id}><td>{new Date(payment.paidAt).toLocaleDateString()}</td><td>{payment.guest}</td><td>{payment.room}</td><td>{payment.method}</td><td><StatusBadge status={payment.status==='Completed'?'Successful':payment.status}/></td><td>{money(payment.amount)}</td><td>{['admin','manager','finance'].includes(user.role)&&<button className="row-action-button" onClick={()=>startForm('refund',payment)}>Refund</button>}</td></tr>)}</tbody></table>{!moduleData?.payments?.length&&<div className="empty-results">No payments in this period. Record an authorized offline payment from a reservation.</div>}</div>
          </section>
          <section className="panel data-panel finance-extra"><div className="panel-heading"><div><span className="panel-kicker">GUEST BILLING</span><h2>Guest financial summaries</h2></div></div><div className="table-scroll"><table><thead><tr><th>GUEST</th><th>COMPLETED STAYS</th><th>BOOKING CHARGES</th><th>SUCCESSFUL PAYMENTS</th><th>REFUNDS</th><th>OUTSTANDING</th></tr></thead><tbody>{(moduleData?.guestSummaries||[]).map((guest)=><tr key={guest.id}><td><strong>{guest.name}</strong><small className="table-sub">{guest.email}</small></td><td>{guest.completedStays}</td><td>{money(Number(guest.totalCharges))}</td><td>{money(Number(guest.totalPayments))}</td><td>{money(Number(guest.refunds))}</td><td>{money(Number(guest.outstanding))}</td></tr>)}</tbody></table>{!moduleData?.guestSummaries?.length&&<div className="empty-results">No guest billing records are available.</div>}</div></section>
          <section className="panel data-panel finance-extra"><div className="panel-heading"><div><span className="panel-kicker">EXPENSE RECORDS</span><h2>Operating expenses</h2></div></div><div className="table-scroll"><table><thead><tr><th>DATE</th><th>CATEGORY</th><th>DESCRIPTION</th><th>STATUS</th><th>AMOUNT</th><th>ACTION</th></tr></thead><tbody>{(moduleData?.expenses||[]).map((expense)=><tr key={expense.id}><td>{expense.expenseDate}</td><td>{expense.category}</td><td>{expense.description}</td><td><StatusBadge status={expense.status}/></td><td>{money(expense.amount)}</td><td>{expense.status==='Pending'&&user.role==='admin'&&<button className="row-action-button" onClick={async()=>{try{await api(`/api/expenses/${expense.id}/approve`,{method:'PATCH'});notify('Expense approved.');await refresh();}catch(e){setError(e.message);}}}>Approve</button>}</td></tr>)}</tbody></table>{!moduleData?.expenses?.length&&<div className="empty-results">No expenses recorded.</div>}</div></section>
          <section className="panel data-panel finance-extra"><div className="panel-heading"><div><span className="panel-kicker">REFUND HISTORY</span><h2>Refunds</h2></div></div><div className="table-scroll"><table><thead><tr><th>DATE</th><th>GUEST</th><th>ROOM</th><th>REASON</th><th>STATUS</th><th>AMOUNT</th><th>ACTION</th></tr></thead><tbody>{(moduleData?.refunds||[]).map((refund)=><tr key={refund.id}><td>{new Date(refund.createdAt).toLocaleDateString()}</td><td>{refund.guest}</td><td>{refund.room}</td><td>{refund.reason}</td><td><StatusBadge status={refund.status}/></td><td>{money(refund.amount)}</td><td>{refund.status==='Pending'&&user.role==='admin'&&<button className="row-action-button" onClick={async()=>{try{await api(`/api/refunds/${refund.id}/approve`,{method:'PATCH'});notify('Refund completed.');await refresh();}catch(e){setError(e.message);}}}>Approve</button>}</td></tr>)}</tbody></table>{!moduleData?.refunds?.length&&<div className="empty-results">No refunds recorded.</div>}</div></section>
        </>}

        {activeNav==='Notifications'&&<section className="panel data-panel"><div className="panel-heading"><div><span className="panel-kicker">OPERATIONS ALERTS</span><h2>Notifications</h2></div></div><div className="notification-list">{(moduleData?.notifications||[]).map((item)=><article key={item.id} className={item.readAt?'notification-read':''}><span className="activity-icon activity-arrival"><Bell size={15}/></span><div><strong>{item.kind}</strong><p>{item.message}</p><time>{new Date(item.createdAt).toLocaleString()}</time></div>{!item.readAt&&<button onClick={()=>markRead(item)}>Mark read</button>}</article>)}{!moduleData?.notifications?.length&&<div className="empty-results">No operational alerts right now.</div>}</div><div className="permission-note">Arrivals, cancellations and room maintenance notices appear here as operations generate them.</div></section>}

        {activeNav==='Settings'&&<section className="panel data-panel appearance-card"><div className="panel-heading"><div><span className="panel-kicker">APPEARANCE</span><h2>Display preferences</h2></div></div><div className="settings-content"><p>Choose Light, Dark or System appearance. System mode follows your device setting and is remembered on this device.</p><label className="appearance-setting">Appearance<select value={theme} onChange={(event)=>setTheme(event.target.value)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label></div></section>}
        {activeNav==='Settings'&&<section className="settings-grid"><article className="panel data-panel"><div className="panel-heading"><div><span className="panel-kicker">HOTEL PROFILE</span><h2>Hotel settings</h2></div></div><div className="settings-content"><p>Hotel information and tax configuration used by operations and reservation totals.</p><button className="primary-button" onClick={()=>startForm('settings')}>Edit hotel details</button><dl><div><dt>Hotel</dt><dd>{moduleData?.hotel?.name}</dd></div><div><dt>Address</dt><dd>{moduleData?.hotel?.address}</dd></div><div><dt>Contact</dt><dd>{moduleData?.hotel?.email||'Not configured'} · {moduleData?.hotel?.phone||'No phone'}</dd></div><div><dt>Tax rate</dt><dd>{moduleData?.hotel?.taxRate}%</dd></div></dl></div><button className="secondary-button profile-edit" onClick={() => setForm({ kind: 'profile', values: { name: user.name, email: user.email, currentPassword: '', newPassword: '' } })}>Update my profile / password</button></article><article className="panel data-panel"><div className="panel-heading"><div><span className="panel-kicker">ACCESS CONTROL</span><h2>User roles</h2></div></div>{isAdmin?(moduleData?.users||[]).map((account)=><div className="user-role-row" key={account.id}><div className="profile-avatar">{account.name.split(' ').map((part)=>part[0]).slice(0,2).join('').toUpperCase()}</div><div><strong>{account.name}</strong><small>{account.email} · {account.accountStatus}</small></div><select aria-label={`Role for ${account.name}`} value={account.role} disabled={account.id===user.id} onChange={(e)=>updateRole(account.id,e.target.value)}>{['admin','manager','receptionist','customer','finance','housekeeping','maintenance','kitchen'].map((role)=><option key={role} value={role}>{role[0].toUpperCase()+role.slice(1)}</option>)}</select>{account.id!==user.id&&<button className="row-action-button" onClick={()=>updateRole(account.id,account.role,account.accountStatus==='active'?'suspended':'active')}>{account.accountStatus==='active'?'Suspend':'Reactivate'}</button>}</div>):<div className="permission-note">Administrator access is required to manage accounts and permissions.</div>}</article></section>}
        {['Housekeeping','Maintenance','Kitchen'].includes(activeNav)&&<SpecialistWorkQueue section={activeNav} items={records} onUpdate={async(item,status)=>{try{const path=activeNav==='Housekeeping'?`/api/housekeeping/tasks/${item.id}`:activeNav==='Maintenance'?`/api/maintenance/requests/${item.id}`:`/api/kitchen/orders/${item.id}`;const payload=activeNav==='Maintenance'?{status,workNotes:item.workNotes||''}:{status,notes:item.notes||''};await api(path,{method:'PATCH',body:JSON.stringify(payload)});notify('Work item updated.');await refresh();}catch(requestError){setError(requestError.message);}}}/>} 
        {activeNav==='Staff & audit'&&<StaffAudit staff={moduleData?.staff||[]} logs={moduleData?.logs||[]} onCreate={()=>startForm('staff')} onChange={updateRole}/>}
        {activeNav==='Operations'&&<section className="operations-manager"><article className="panel data-panel"><div className="panel-heading"><div><span className="panel-kicker">ROOM TURNOVER</span><h2>Housekeeping</h2></div><button className="primary-button" onClick={()=>startForm('housekeeping')}><Plus size={15}/>Assign task</button></div><div className="specialist-queue">{(moduleData?.housekeeping||[]).map((item)=><article key={item.id}><div><strong>Room {item.room}</strong><p>{item.priority} · {item.instructions}</p></div><StatusBadge status={item.status}/></article>)}{!moduleData?.housekeeping?.length&&<div className="empty-results">No housekeeping tasks.</div>}</div></article><article className="panel data-panel"><div className="panel-heading"><div><span className="panel-kicker">ROOM ISSUES</span><h2>Maintenance</h2></div><button className="primary-button" onClick={()=>startForm('maintenance')}><Plus size={15}/>Report issue</button></div><div className="specialist-queue">{(moduleData?.maintenance||[]).map((item)=><article key={item.id}><div><strong>Room {item.room} · {item.issue}</strong><p>{item.priority} · {item.workNotes||item.status}</p></div><StatusBadge status={item.status}/></article>)}{!moduleData?.maintenance?.length&&<div className="empty-results">No maintenance requests.</div>}</div></article><article className="panel data-panel"><div className="panel-heading"><div><span className="panel-kicker">GUEST CANCELLATIONS</span><h2>Cancellation requests</h2></div></div><div className="specialist-queue">{(moduleData?.reservations||[]).filter((item)=>item.cancellationRequestedAt).map((item)=><article key={item.id}><div><strong>{item.guest} · Room {item.room}</strong><p>{item.checkIn}–{item.checkOut} · {money(item.amount)}</p></div><button className="row-action-button" onClick={()=>updateReservation(item.id,{status:'Cancelled'},'Cancellation approved.')}>Approve cancellation</button></article>)}{!(moduleData?.reservations||[]).some((item)=>item.cancellationRequestedAt)&&<div className="empty-results">No pending cancellation requests.</div>}</div></article><article className="panel data-panel"><div className="panel-heading"><div><span className="panel-kicker">GUEST SERVICE</span><h2>Guest requests</h2></div></div><div className="specialist-queue">{(moduleData?.guestRequests||[]).map((item)=><article key={item.id}><div><strong>{item.category} · {item.guest}</strong><p>{item.message}</p></div><StatusBadge status={item.status}/></article>)}{!moduleData?.guestRequests?.length&&<div className="empty-results">No guest requests.</div>}</div></article></section>}
        <footer className="dashboard-footer"><span>MADE FOR MOMENTS THAT MATTER <span>✳</span></span><span>HAVEN HOTEL MANAGEMENT <b>·</b> LIVE DATABASE</span></footer>
      </div>
    </main>
  </div>;
}

function SpecialistWorkQueue({ section, items, onUpdate }) {
  const views={
    Housekeeping:{title:'Housekeeping tasks',states:['Pending','In Progress','Clean','Inspected'],name:(item)=>`Room ${item.room} · ${item.roomType}`,detail:(item)=>`${item.priority} priority · ${item.instructions||'Room turnover'}`},
    Maintenance:{title:'Maintenance requests',states:['Open','Assigned','In Progress','Resolved','Closed'],name:(item)=>`Room ${item.room} · ${item.issue}`,detail:(item)=>`${item.priority} priority · ${item.instructions||item.workNotes||'No work instructions'}`},
    Kitchen:{title:'Kitchen orders',states:['Received','Preparing','Ready','Delivered','Cancelled'],name:(item)=>`Room ${item.room} · ${item.items}`,detail:(item)=>`${item.requestedFor}${item.dietaryNotes?` · Dietary: ${item.dietaryNotes}`:''}`},
  }[section];
  return <section className="panel data-panel"><div className="panel-heading"><div><span className="panel-kicker">TEAM WORK QUEUE</span><h2>{views.title}</h2></div></div><div className="specialist-queue">{items.map((item)=><article key={item.id}><div><strong>{views.name(item)}</strong><p>{views.detail(item)}</p></div><StatusBadge status={item.status}/><select aria-label={`Update status: ${views.name(item)}`} value={item.status} onChange={(event)=>onUpdate(item,event.target.value)}>{views.states.map((state)=><option key={state}>{state}</option>)}</select>{section==='Maintenance'&&<small>{item.workNotes}</small>}</article>)}{!items.length&&<div className="empty-results">No assigned work at this time.</div>}</div></section>;
}

function StaffAudit({ staff, logs, onCreate, onChange }) {
  return <section className="staff-audit-grid"><article className="panel data-panel"><div className="panel-heading"><div><span className="panel-kicker">EMPLOYEE ACCESS</span><h2>Staff accounts</h2></div><button className="primary-button" onClick={onCreate}><Plus size={15}/>Add staff member</button></div><div className="staff-list">{staff.map((account)=><div className="user-role-row" key={account.id}><div className="profile-avatar">{account.name.split(' ').map((part)=>part[0]).slice(0,2).join('').toUpperCase()}</div><div className="staff-identity"><strong>{account.name}</strong><small>{account.email} · {account.department||'No department'}</small><small>{account.employeeId?`Employee ${account.employeeId} · `:''}{account.lastLogin?`Last login ${new Date(account.lastLogin).toLocaleString()}`:'Never signed in'}</small></div><select aria-label={`Role for ${account.name}`} value={account.role} disabled={account.id===user.id} onChange={(e)=>updateRole(account.id,e.target.value)}><option value="admin">Administrator</option><option value="manager">Manager</option><option value="receptionist">Receptionist</option><option value="customer">Customer / Guest</option><option value="finance">Finance / Accountant</option><option value="housekeeping">Housekeeping</option><option value="maintenance">Maintenance</option><option value="kitchen">Kitchen</option></select><select aria-label={`Account status for ${account.name}`} value={account.accountStatus} onChange={(event)=>onChange(account.id,account.role,event.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option><option value="pending">Pending approval</option></select></div>)}{!staff.length&&<div className="empty-results">No user accounts found.</div>}</div></article><article className="panel data-panel"><div className="panel-heading"><div><span className="panel-kicker">SECURITY HISTORY</span><h2>Recent audit activity</h2></div></div><div className="audit-list">{logs.map((log)=><article key={log.id}><strong>{log.action.replaceAll('_',' ')} · {log.entity}</strong><p>{log.actor||'System'}{log.entityId?` · record ${log.entityId}`:''}{log.details?` · ${log.details}`:''}</p><time>{new Date(log.createdAt).toLocaleString()}</time></article>)}{!logs.length&&<div className="empty-results">No audit events recorded.</div>}</div></article></section>;
}

function CustomerPortal({ user, setUser, theme, setTheme }) {
  const [reservations,setReservations]=useState([]);
  const [rooms,setRooms]=useState([]);
  const [payments,setPayments]=useState([]);
  const [invoices,setInvoices]=useState([]);
  const [profile,setProfile]=useState({name:user.name,email:user.email,phone:user.phone||''});
  const [request,setRequest]=useState({category:'service',message:''});
  const [dates,setDates]=useState({checkIn:new Date(Date.now()+86400000).toISOString().slice(0,10),checkOut:new Date(Date.now()+2*86400000).toISOString().slice(0,10)});
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [section,setSection] = useState('My stays');
  const navigate=useNavigate();
  async function refresh(){
    setLoading(true);
    try{
      const [bookingData,paymentData,roomData,invoiceData]=await Promise.all([
        api('/api/customer/reservations'),api('/api/customer/payments'),
        api(`/api/customer/rooms?checkIn=${dates.checkIn}&checkOut=${dates.checkOut}`),
        api('/api/customer/invoices'),
      ]);
      setReservations(bookingData.reservations);setPayments(paymentData.payments);setRooms(roomData.rooms);setInvoices(invoiceData.invoices);
    }catch(requestError){setError(requestError.message);}finally{setLoading(false);}
  }
  useEffect(()=>{refresh();},[dates.checkIn,dates.checkOut]);
  async function book(room){
    setError('');try{await api('/api/customer/reservations',{method:'POST',body:JSON.stringify({roomId:room.id,...dates})});setNotice('Reservation request received. The hotel will confirm it shortly.');setSection('My stays');await refresh();}
    catch(requestError){setError(requestError.message);}
  }
  async function cancel(id){
    setError('');try{const result=await api(`/api/customer/reservations/${id}/cancellation-request`,{method:'POST'});setNotice(result.message);}
    catch(requestError){setError(requestError.message);}
  }
  async function logout(){await api('/api/auth/logout',{method:'POST'}).catch(()=>{});setUser(null);navigate('/login');}
  async function saveProfile(event){event.preventDefault();try{const result=await api('/api/customer/profile',{method:'PATCH',body:JSON.stringify(profile)});setUser(result.user);setNotice('Profile updated.');}catch(e){setError(e.message);}}
  async function sendRequest(event){event.preventDefault();try{const result=await api('/api/customer/requests',{method:'POST',body:JSON.stringify(request)});setNotice(result.message);setRequest({...request,message:''});}catch(e){setError(e.message);}}
  const balance=(reservation)=>Math.max(0,reservation.amount-reservation.paid);
  return <main className="customer-portal">
    <header className="customer-header"><Brand/><div className="customer-header-actions"><button className="theme-toggle" aria-label={`Switch appearance. Current setting: ${theme}.`} onClick={()=>setTheme(theme==='light'?'dark':theme==='dark'?'system':'light')}>{theme==='dark'?<Moon size={17}/>:<Sun size={17}/>}</button><span>{user.name}</span><button className="secondary-button" onClick={logout}>Sign out</button></div></header>
    <section className="customer-welcome"><span className="panel-kicker">GUEST PORTAL</span><h1>Your stay, <em>beautifully</em> in balance.</h1><p>Manage your reservations and find your next stay at Haven.</p></section>
    {notice&&<div className="notice-banner">{notice}<button onClick={()=>setNotice('')} aria-label="Dismiss"><X size={15}/></button></div>}{error&&<div className="form-error global-error">{error}<button onClick={()=>setError('')} aria-label="Dismiss">×</button></div>}
    <nav className="customer-tabs"><button className={section==='My stays'?'customer-tab-active':''} onClick={()=>setSection('My stays')}>My stays</button><button className={section==='Explore rooms'?'customer-tab-active':''} onClick={()=>setSection('Explore rooms')}>Explore rooms</button><button className={section==='Payments'?'customer-tab-active':''} onClick={()=>setSection('Payments')}>Payment history</button><button className={section==='Profile'?'customer-tab-active':''} onClick={()=>setSection('Profile')}>Profile & requests</button></nav>
    {section==='My stays'&&<section className="customer-bookings">{reservations.map((item)=><article className="customer-booking" key={item.id}><div className="customer-booking-heading"><div><span className="panel-kicker">{item.roomType} · ROOM {item.room}</span><h2>{new Date(`${item.checkIn}T00:00:00`).toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})} – {new Date(`${item.checkOut}T00:00:00`).toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})}</h2></div><StatusBadge status={item.status}/></div><div className="customer-financial"><span>Booking total <strong>{money(item.amount)}</strong></span><span>Paid <strong>{money(item.paid)}</strong></span><span>Balance <strong>{money(balance(item))}</strong></span></div>{['Pending','Confirmed'].includes(item.status)&&<button className="secondary-button" onClick={()=>cancel(item.id)}>Request cancellation</button>}{balance(item)>0&&<p className="payment-provider-note">Online payment checkout is not configured for this hotel. No payment has been initiated.</p>}</article>)}{!reservations.length&&<div className="empty-results">You do not have any reservations yet. Explore available rooms to plan a stay.</div>}</section>}
    {section==='Explore rooms'&&<section className="panel customer-rooms"><div className="customer-date-picker"><label>Check-in<input type="date" value={dates.checkIn} onChange={(event)=>setDates({...dates,checkIn:event.target.value})}/></label><label>Check-out<input type="date" value={dates.checkOut} onChange={(event)=>setDates({...dates,checkOut:event.target.value})}/></label></div><div className="customer-room-grid">{rooms.map((room,index)=><article key={room.id}><img className="customer-room-photo" src={ROOM_PHOTOS[index%ROOM_PHOTOS.length]} alt={`${room.type} accommodation`} loading="lazy"/><span className="panel-kicker">UP TO {room.capacity} GUESTS</span><h2>{room.type}</h2><p>Room {room.number} · Available for your dates</p><div className="customer-room-rate">{money(room.rate)}<small> / night</small></div><button className="primary-button" onClick={()=>book(room)}>Request this room <ArrowRight size={15}/></button></article>)}{!rooms.length&&<div className="empty-results">No rooms are available for those dates. Try different dates.</div>}</div></section>}
    {section==='Payments'&&<><section className="panel data-panel"><div className="panel-heading"><div><span className="panel-kicker">YOUR ACCOUNT</span><h2>Payment history</h2></div></div><div className="table-scroll"><table><thead><tr><th>DATE</th><th>METHOD</th><th>REFERENCE</th><th>STATUS</th><th>AMOUNT</th></tr></thead><tbody>{payments.map((payment)=><tr key={payment.id}><td>{new Date(payment.paidAt).toLocaleDateString()}</td><td>{payment.method}</td><td>{payment.reference||'—'}</td><td><StatusBadge status={payment.status==='Completed'?'Successful':payment.status}/></td><td>{money(payment.amount)}</td></tr>)}</tbody></table>{!payments.length&&<div className="empty-results">No payments are recorded for your account.</div>}</div></section><section className="panel data-panel finance-extra"><div className="panel-heading"><div><span className="panel-kicker">YOUR BILLING DOCUMENTS</span><h2>Invoices</h2></div></div><div className="customer-invoices">{invoices.map((invoice)=><article key={invoice.id}><strong>{invoice.confirmationNumber}</strong><span>Subtotal {money(invoice.subtotal)} · Tax {money(invoice.taxes)} · Discount {money(invoice.discount)}</span><b>Total {money(invoice.total)}</b><button className="row-action-button" onClick={()=>downloadInvoicePdf(invoice).catch((pdfError)=>setError(pdfError.message))}>Download invoice PDF</button></article>)}{!invoices.length&&<div className="empty-results">No invoices are available yet.</div>}</div></section></>}
    {section==='Profile'&&<section className="customer-profile-grid"><form className="panel customer-form" onSubmit={saveProfile}><div className="panel-heading"><div><span className="panel-kicker">ACCOUNT DETAILS</span><h2>Update your profile</h2></div></div><label>Name<input value={profile.name} onChange={(e)=>setProfile({...profile,name:e.target.value})} required minLength="2"/></label><label>Email<input type="email" value={profile.email} onChange={(e)=>setProfile({...profile,email:e.target.value})} required/></label><label>Phone<input value={profile.phone} onChange={(e)=>setProfile({...profile,phone:e.target.value})}/></label><button className="primary-button">Save profile</button></form><form className="panel customer-form" onSubmit={sendRequest}><div className="panel-heading"><div><span className="panel-kicker">WE’RE HERE TO HELP</span><h2>Service request or feedback</h2></div></div><label>Request type<select value={request.category} onChange={(e)=>setRequest({...request,category:e.target.value})}><option value="service">Service request</option><option value="dietary">Dietary request</option><option value="accessibility">Accessibility</option><option value="feedback">Feedback</option><option value="other">Other</option></select></label><label>Message<textarea value={request.message} onChange={(e)=>setRequest({...request,message:e.target.value})} required minLength="3" maxLength="1000"/></label><button className="primary-button">Send request</button></form></section>}
    {loading&&<div className="customer-loading">Updating your account…</div>}<footer className="dashboard-footer"><span>HAVEN GUEST PORTAL</span><span>YOUR ACCOUNT DETAILS ARE PRIVATE</span></footer>
  </main>;
}

function App() {
  const [user, setUser] = useState(null);
  const [data, setData] = useState(null);
  const [theme, setThemeState] = useState(() => {
    const saved=window.localStorage.getItem('haven-theme');
    return ['light','dark','system'].includes(saved)?saved:'system';
  });
  const [mode, setMode] = useState(() => ({
    '/register':'register',
    '/setup-admin':'adminBootstrap',
    '/forgot-password':'forgotPassword',
    '/reset-password':'resetPassword',
  }[window.location.pathname] || 'login'));
  const [checking, setChecking] = useState(true);

  function setTheme(value) { window.localStorage.setItem('haven-theme',value);setThemeState(value); }
  function setAuthMode(next) {
    setMode(next);
    const paths={register:'/register',adminBootstrap:'/setup-admin',forgotPassword:'/forgot-password',resetPassword:'/reset-password',login:'/login'};
    const token=next==='resetPassword'?new URLSearchParams(window.location.search).get('token'):null;
    window.history.replaceState({},'',`${paths[next] || '/login'}${token?`?token=${encodeURIComponent(token)}`:''}`);
  }

  useEffect(() => {
    const media=window.matchMedia('(prefers-color-scheme: dark)');
    const apply=()=>document.documentElement.dataset.theme=theme==='system'?(media.matches?'dark':'light'):theme;
    apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);
  },[theme]);

  useEffect(() => {
    api('/api/auth/me').then(({ user: currentUser }) => {
      setUser(currentUser);
      if(currentUser.role==='customer')return setData({customer:true});
      return api('/api/dashboard').then(setData);
    }).catch(() => {}).finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="loading-screen"><Brand /><span className="loading-spinner" /></div>;
  if (user && !data) return <div className="loading-screen"><Brand /><span className="loading-spinner" /></div>;
  if (user && data && user.role==='customer') return <CustomerPortal user={user} setUser={setUser} theme={theme} setTheme={setTheme}/>;
  if (user && data) return <Routes><Route path="*" element={<OperationsDashboard user={user} setUser={setUser} data={data} setData={setData} theme={theme} setTheme={setTheme}/>} /></Routes>;
  return <Routes><Route path="*" element={<AuthPage mode={mode} setMode={setAuthMode} setUser={setUser} setData={setData} theme={theme} setTheme={setTheme}/>} /></Routes>;
}

export default App;
