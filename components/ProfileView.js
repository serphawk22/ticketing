'use client';

import { useState, useRef, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ClientShell from '@/components/ClientShell';
import Avatar from '@/components/Avatar';
import { useToasts, Toaster } from '@/components/Toaster';
import { formatSalary } from '@/lib/currency';

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function EyeIcon({ off = false }) {
  if (off) {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function BankBuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="21" x2="21" y2="21" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <polyline points="5 6 12 3 19 6" />
      <line x1="4" y1="10" x2="4" y2="21" />
      <line x1="20" y1="10" x2="20" y2="21" />
      <line x1="8" y1="14" x2="8" y2="17" />
      <line x1="12" y1="14" x2="12" y2="17" />
      <line x1="16" y1="14" x2="16" y2="17" />
    </svg>
  );
}

function BriefcaseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function LinkedinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9h2.79v8.37H6.46v-8.37M7.86 6.3a1.62 1.62 0 0 0-1.63 1.62c0 .89.73 1.62 1.63 1.62a1.62 1.62 0 0 0 1.62-1.62c0-.89-.73-1.62-1.62-1.62Z" />
    </svg>
  );
}

function formatDate(isoOrDateString) {
  if (!isoOrDateString) return '—';
  try {
    const d = new Date(isoOrDateString);
    if (Number.isNaN(d.getTime())) return String(isoOrDateString);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return String(isoOrDateString);
  }
}

export default function ProfileView({
  initialProfile,
  currentUser,
  projects = [],
  initialTickets = [],
  myIssuesCount = 0,
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { toasts, push, dismiss, pause, resume } = useToasts();

  const fileInputRef = useRef(null);

  // Active saved profile state
  const [profile, setProfile] = useState(initialProfile || {});

  // Personal Information form state
  const [name, setName] = useState(initialProfile?.name || '');
  const [age, setAge] = useState(initialProfile?.age !== null ? String(initialProfile?.age ?? '') : '');
  const [githubUrl, setGithubUrl] = useState(initialProfile?.github_url || '');
  const [linkedinUrl, setLinkedinUrl] = useState(initialProfile?.linkedin_url || '');
  const [personalSaving, setPersonalSaving] = useState(false);
  const [personalError, setPersonalError] = useState('');

  // Bank Details form state
  const [accountHolderName, setAccountHolderName] = useState(
    initialProfile?.bank_details?.account_holder_name || ''
  );
  const [bankName, setBankName] = useState(initialProfile?.bank_details?.bank_name || '');
  const [accountNumber, setAccountNumber] = useState(
    initialProfile?.bank_details?.account_number_masked || ''
  );
  const [ifscCode, setIfscCode] = useState(initialProfile?.bank_details?.ifsc_code || '');
  const [showRawAccount, setShowRawAccount] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);
  const [bankError, setBankError] = useState('');

  // Avatar upload state
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState(initialProfile?.avatar_url || '');

  // Reset Personal Info to last saved values
  function handleCancelPersonal() {
    setName(profile?.name || '');
    setAge(profile?.age !== null && profile?.age !== undefined ? String(profile.age) : '');
    setGithubUrl(profile?.github_url || '');
    setLinkedinUrl(profile?.linkedin_url || '');
    setPersonalError('');
  }

  // Reset Bank Details to last saved values
  function handleCancelBank() {
    setAccountHolderName(profile?.bank_details?.account_holder_name || '');
    setBankName(profile?.bank_details?.bank_name || '');
    setAccountNumber(profile?.bank_details?.account_number_masked || '');
    setIfscCode(profile?.bank_details?.ifsc_code || '');
    setShowRawAccount(false);
    setBankError('');
  }

  // Save Personal Info
  async function handleSavePersonal(e) {
    e.preventDefault();
    setPersonalError('');

    if (!name.trim()) {
      setPersonalError('Full name is required.');
      return;
    }

    setPersonalSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          age: age.trim() === '' ? null : age.trim(),
          github_url: githubUrl.trim(),
          linkedin_url: linkedinUrl.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to update personal information.');
      }

      setProfile(data.profile);
      setName(data.profile.name);
      setAge(data.profile.age !== null ? String(data.profile.age) : '');
      setGithubUrl(data.profile.github_url || '');
      setLinkedinUrl(data.profile.linkedin_url || '');

      push({ message: 'Personal details updated successfully.', tone: 'success' });
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setPersonalError(err.message);
      push({ message: err.message, tone: 'error' });
    } finally {
      setPersonalSaving(false);
    }
  }

  // Save Bank Details
  async function handleSaveBank(e) {
    e.preventDefault();
    setBankError('');

    setBankSaving(true);
    try {
      const res = await fetch('/api/profile/bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_holder_name: accountHolderName.trim(),
          bank_name: bankName.trim(),
          account_number: accountNumber.trim(),
          ifsc_code: ifscCode.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save bank details.');
      }

      setProfile((prev) => ({
        ...prev,
        bank_details: data.bank_details,
      }));
      setAccountHolderName(data.bank_details.account_holder_name || '');
      setBankName(data.bank_details.bank_name || '');
      setAccountNumber(data.bank_details.account_number_masked || '');
      setIfscCode(data.bank_details.ifsc_code || '');
      setShowRawAccount(false);

      push({ message: 'Bank details saved securely.', tone: 'success' });
    } catch (err) {
      setBankError(err.message);
      push({ message: err.message, tone: 'error' });
    } finally {
      setBankSaving(false);
    }
  }

  // Handle avatar file selection & upload
  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      push({ message: 'Profile picture must be under 5MB.', tone: 'error' });
      return;
    }

    // Validate type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      push({ message: 'File format must be JPG, PNG, GIF, or WebP.', tone: 'error' });
      return;
    }

    // Immediate preview
    const reader = new FileReader();
    reader.onload = (uploadEvent) => {
      setAvatarPreview(uploadEvent.target.result);
    };
    reader.readAsDataURL(file);

    setAvatarUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to upload photo.');
      }

      setProfile(data.profile);
      setAvatarPreview(data.avatar_url);
      push({ message: 'Profile photo updated.', tone: 'success' });
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      // Revert preview on failure
      setAvatarPreview(profile?.avatar_url || '');
      push({ message: err.message, tone: 'error' });
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // Format payment status for pill display
  const paymentStatus = profile?.payment_status?.toLowerCase();
  const paymentStatusText =
    paymentStatus === 'paid'
      ? 'Paid'
      : paymentStatus === 'pending'
      ? 'Pending'
      : paymentStatus === 'processing'
      ? 'Processing'
      : paymentStatus === 'unpaid'
      ? 'Unpaid'
      : 'No records';

  const paymentStatusClass =
    paymentStatus === 'paid'
      ? 'pill-active'
      : paymentStatus === 'pending' || paymentStatus === 'processing'
      ? 'pill-warning'
      : paymentStatus === 'unpaid'
      ? 'pill-inactive'
      : 'pill-neutral';

  const content = (
    <div className="profile-container">
      {/* Page Header */}
      <div className="profile-header">
        <h1 className="profile-title">My Profile</h1>
        <p className="profile-subtitle">Manage your personal information</p>
      </div>

      {/* Top Grid: Avatar + Personal Info */}
      <div className="profile-top-grid">
        {/* Card 1: Profile Picture */}
        <div className="profile-card profile-card-avatar">
          <div className="profile-card-header">
            <h2>Profile Picture</h2>
            <p>Upload your profile photo</p>
          </div>

          <div className="profile-avatar-display">
            <div className="profile-avatar-circle-wrap">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt={profile?.name || 'Profile'}
                  className="profile-avatar-img"
                />
              ) : (
                <div className="profile-avatar-fallback">
                  <Avatar name={profile?.name || currentUser.name} assigned size={112} />
                </div>
              )}
              <button
                type="button"
                className="profile-avatar-badge"
                onClick={() => fileInputRef.current?.click()}
                title="Change photo"
                aria-label="Change photo"
              >
                <CameraIcon />
              </button>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleAvatarChange}
              style={{ display: 'none' }}
              aria-label="Upload photo input"
            />

            <button
              type="button"
              className="btn-secondary profile-upload-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
            >
              <UploadIcon />
              {avatarUploading ? 'Uploading…' : 'Upload Photo'}
            </button>
            <span className="profile-hint">JPG, PNG, GIF or WebP. Max 5MB.</span>
          </div>
        </div>

        {/* Card 2: Personal Information */}
        <div className="profile-card profile-card-personal">
          <div className="profile-card-header">
            <h2>Personal Information</h2>
            <p>Update your profile details</p>
          </div>

          <form onSubmit={handleSavePersonal} className="profile-form">
            {personalError && <div className="error-banner">{personalError}</div>}

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="profile-name">
                  Name <span className="req-star">*</span>
                </label>
                <input
                  id="profile-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="profile-email">Email (cannot be changed)</label>
                <input
                  id="profile-email"
                  type="text"
                  value={profile?.email || currentUser?.email || 'Not provided'}
                  readOnly
                  disabled
                  className="input-readonly"
                  title="Email cannot be changed"
                />
              </div>

              {currentUser.role === 'client' && Boolean(profile?.secondary_email) && (
                <div className="form-group">
                  <label htmlFor="profile-secondary-email">Secondary Email</label>
                  <input
                    id="profile-secondary-email"
                    type="text"
                    value={profile.secondary_email}
                    readOnly
                    disabled
                    className="input-readonly"
                    title="Secondary email cannot be changed"
                  />
                </div>
              )}
            </div>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="profile-age">Age</label>
                <input
                  id="profile-age"
                  type="number"
                  min="16"
                  max="120"
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="e.g. 28"
                />
              </div>

              <div className="form-group">
                <label htmlFor="profile-joined">Date Joined</label>
                <div className="input-with-icon">
                  <input
                    id="profile-joined"
                    type="text"
                    value={formatDate(profile?.created_at || currentUser?.created_at)}
                    readOnly
                    disabled
                    className="input-readonly"
                    title="Account creation date cannot be changed"
                  />
                  <span className="input-icon" aria-hidden="true">
                    <CalendarIcon />
                  </span>
                </div>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="profile-github">GitHub URL</label>
              <div className="input-with-icon">
                <input
                  id="profile-github"
                  type="url"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="https://github.com/username"
                />
                <span className="input-icon" aria-hidden="true">
                  <GithubIcon />
                </span>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="profile-linkedin">LinkedIn URL</label>
              <div className="input-with-icon">
                <input
                  id="profile-linkedin"
                  type="url"
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  placeholder="https://linkedin.com/in/username"
                />
                <span className="input-icon" aria-hidden="true">
                  <LinkedinIcon />
                </span>
              </div>
            </div>

            <div className="profile-form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={handleCancelPersonal}
                disabled={personalSaving}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={personalSaving}>
                {personalSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Middle Card: Salary & Department (Hidden for Clients) */}
      {currentUser.role !== 'client' && (
        <div className="profile-card profile-card-employment">
          <div className="profile-card-header-row">
            <div className="profile-card-title-icon">
              <BriefcaseIcon />
            </div>
            <div>
              <h2>Salary & Department</h2>
              <p>Set by your administrator</p>
            </div>
          </div>

          <div className="profile-employment-grid">
            <div className="profile-employment-item">
              <span className="profile-emp-label">Base Salary</span>
              <span className="profile-emp-value">
                {formatSalary(profile?.base_salary, profile?.salary_currency)}
              </span>
            </div>

            <div className="profile-employment-item">
              <span className="profile-emp-label">Department</span>
              <span className="profile-emp-value">
                {profile?.department || '—'}
              </span>
            </div>

            <div className="profile-employment-item">
              <span className="profile-emp-label">Last Payment Date</span>
              <span className="profile-emp-value">
                {profile?.last_payment_date ? formatDate(profile.last_payment_date) : '—'}
              </span>
            </div>

            <div className="profile-employment-item">
              <span className="profile-emp-label">Payment Status</span>
              <span className="profile-emp-value">
                <span className={`pill ${paymentStatusClass}`}>
                  {paymentStatusText}
                </span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Card: Bank Details */}
      <div className="profile-card profile-card-bank">
        <div className="profile-card-header-row">
          <div className="profile-card-title-icon">
            <BankBuildingIcon />
          </div>
          <div>
            <h2>Bank Details</h2>
            <p>Your salary will be credited to this account</p>
          </div>
        </div>

        <form onSubmit={handleSaveBank} className="profile-form">
          {bankError && <div className="error-banner">{bankError}</div>}

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="bank-holder">Account Holder Name</label>
              <input
                id="bank-holder"
                type="text"
                value={accountHolderName}
                onChange={(e) => setAccountHolderName(e.target.value)}
                placeholder="As on bank account"
              />
            </div>

            <div className="form-group">
              <label htmlFor="bank-name">Bank Name</label>
              <input
                id="bank-name"
                type="text"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. State Bank of India"
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="bank-account">Account Number</label>
              <div className="input-with-button">
                <input
                  id="bank-account"
                  type={showRawAccount ? 'text' : 'password'}
                  value={
                    showRawAccount
                      ? profile?.bank_details?.account_number || accountNumber
                      : accountNumber
                  }
                  onChange={(e) => {
                    setAccountNumber(e.target.value);
                    if (showRawAccount) {
                      setProfile((p) => ({
                        ...p,
                        bank_details: { ...p.bank_details, account_number: e.target.value },
                      }));
                    }
                  }}
                  placeholder="e.g. 1234567890"
                />
                <button
                  type="button"
                  className="input-action-btn"
                  onClick={() => setShowRawAccount((s) => !s)}
                  title={showRawAccount ? 'Mask account number' : 'Show account number'}
                  aria-label={showRawAccount ? 'Mask account number' : 'Show account number'}
                >
                  <EyeIcon off={showRawAccount} />
                </button>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="bank-ifsc">IFSC Code</label>
              <input
                id="bank-ifsc"
                type="text"
                value={ifscCode}
                onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                placeholder="e.g. SBIN0001234"
                maxLength={11}
              />
            </div>
          </div>

          <div className="profile-form-actions profile-bank-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={handleCancelBank}
              disabled={bankSaving}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={bankSaving}>
              {bankSaving ? 'Saving…' : 'Save Bank Details'}
            </button>
          </div>
        </form>
      </div>

      <Toaster toasts={toasts} dismiss={dismiss} pause={pause} resume={resume} />
    </div>
  );

  if (currentUser.role === 'client') {
    return (
      <ClientShell currentUser={currentUser} single>
        {content}
      </ClientShell>
    );
  }

  return (
    <AppShell
      currentUser={currentUser}
      projects={projects}
      projectCounts={null}
      employeeCount={null}
      myIssuesCount={myIssuesCount}
      view="profile"
      filter="all"
      onFilterChange={() => router.push('/?filter=mine')}
      projectId="all"
      onProjectChange={(id) => router.push(`/?project=${id}`)}
      onCreate={null}
    >
      {content}
    </AppShell>
  );
}

