(function () {
  'use strict';

  // Backend API URL Resolution
  const metaBackend = document.querySelector('meta[name="backend-url"]');
  const BACKEND_URL = (metaBackend && metaBackend.content) ||
    window.BACKEND_URL ||
    (window.location.hostname ? window.location.protocol + '//' + window.location.hostname + ':3000' : 'http://127.0.0.1:3000');

  let activePackages = [];
  let selectedPackage = null;
  let currentOrderId = null;
  let pollInterval = null;
  let countdownInterval = null;

  // DOM Elements
  const modal = document.getElementById('qrisModal');
  const btnOpenModal = document.getElementById('btnOpenQrisModal');
  const btnCloseModal = document.getElementById('btnCloseQrisModal');
  const packageContainer = document.getElementById('packageContainer');
  const btnPayQris = document.getElementById('btnPayQris');
  const stepSelectPkg = document.getElementById('stepSelectPkg');
  const stepShowQr = document.getElementById('stepShowQr');
  const stepSuccess = document.getElementById('stepSuccess');
  const qrImage = document.getElementById('qrImage');
  const qrAmount = document.getElementById('qrAmount');
  const qrTimer = document.getElementById('qrTimer');
  const voucherCodeEl = document.getElementById('voucherCodeDisplay');
  const voucherDurationEl = document.getElementById('voucherDurationDisplay');
  const btnCopyVoucher = document.getElementById('btnCopyVoucher');
  const btnAutoLogin = document.getElementById('btnAutoLogin');
  const phoneInput = document.getElementById('customerPhone');

  // Theme Controller (MUIX Dark/Light Mode)
  const btnThemeToggle = document.getElementById('btnThemeToggle');
  const iconSun = document.getElementById('iconSun');
  const iconMoon = document.getElementById('iconMoon');

  function initTheme() {
    const savedTheme = localStorage.getItem('miuix_theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const currentTheme = savedTheme || (prefersDark ? 'dark' : 'light');
    applyTheme(currentTheme);

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        if (!localStorage.getItem('miuix_theme')) {
          applyTheme(e.matches ? 'dark' : 'light');
        }
      });
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') {
      if (iconSun) iconSun.style.display = 'block';
      if (iconMoon) iconMoon.style.display = 'none';
    } else {
      if (iconSun) iconSun.style.display = 'none';
      if (iconMoon) iconMoon.style.display = 'block';
    }
  }

  if (btnThemeToggle) {
    btnThemeToggle.addEventListener('click', function () {
      const current = document.documentElement.getAttribute('data-theme') ||
        (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = current === 'dark' ? 'light' : 'dark';
      localStorage.setItem('miuix_theme', next);
      applyTheme(next);
    });
  }

  initTheme();

  // Tab switching (Voucher vs Member)
  const tabVoucher = document.getElementById('tabVoucher');
  const tabMember = document.getElementById('tabMember');
  const groupPassword = document.getElementById('groupPassword');
  const labelUsername = document.getElementById('labelUsername');
  const inputUsername = document.getElementById('username');
  const inputPassword = document.getElementById('password');

  if (tabVoucher && tabMember) {
    tabVoucher.addEventListener('click', function () {
      tabVoucher.classList.add('active');
      tabMember.classList.remove('active');
      if (groupPassword) groupPassword.style.display = 'none';
      if (labelUsername) labelUsername.innerText = 'Voucher Code';
      if (inputUsername) inputUsername.placeholder = 'Enter voucher code';
    });

    tabMember.addEventListener('click', function () {
      tabMember.classList.add('active');
      tabVoucher.classList.remove('active');
      if (groupPassword) groupPassword.style.display = 'block';
      if (labelUsername) labelUsername.innerText = 'Username';
      if (inputUsername) inputUsername.placeholder = 'Enter username';
    });
  }

  // Modal Controls
  if (btnOpenModal) {
    btnOpenModal.addEventListener('click', function () {
      resetModalState();
      modal.classList.add('active');
      fetchPackages();
    });
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', closeModal);
  }

  function closeModal() {
    if (modal) modal.classList.remove('active');
    stopPolling();
    stopCountdown();
  }

  function resetModalState() {
    stepSelectPkg.style.display = 'block';
    stepShowQr.style.display = 'none';
    stepSuccess.style.display = 'none';
    btnPayQris.disabled = true;
    btnPayQris.innerHTML = '<span>Continue to Payment</span>';
  }

  // Fetch Packages
  async function fetchPackages() {
    try {
      packageContainer.innerHTML = '<p style="text-align:center;font-size:0.85rem;color:var(--miuix-text-secondary);grid-column:span 2;">Loading packages...</p>';
      const res = await fetch(BACKEND_URL + '/api/packages');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      activePackages = data.packages || [];
      renderPackages(activePackages);
    } catch (err) {
      console.warn('Backend unavailable, using default packages:', err.message);
      activePackages = [
        { id: '1h', name: '1 Hour', price: 2000, uptime_limit: '1h' },
        { id: '3h', name: '3 Hours', price: 5000, uptime_limit: '3h' },
        { id: '1d', name: '1 Day', price: 10000, uptime_limit: '1d' },
        { id: '7d', name: '7 Days', price: 35000, uptime_limit: '7d' }
      ];
      renderPackages(activePackages);
    }
  }

  function renderPackages(packages) {
    packageContainer.innerHTML = '';
    packages.forEach(function (pkg) {
      const card = document.createElement('div');
      card.className = 'package-card';
      card.innerHTML =
        '<div class="pkg-name">' + escapeHtml(pkg.name) + '</div>' +
        '<div class="pkg-price">Rp ' + Number(pkg.price).toLocaleString('id-ID') + '</div>' +
        '<div class="pkg-time">Valid: ' + escapeHtml(pkg.uptime_limit || pkg.uptimeLimit || '') + '</div>';

      card.addEventListener('click', function () {
        document.querySelectorAll('.package-card').forEach(function (el) {
          el.classList.remove('selected');
        });
        card.classList.add('selected');
        selectedPackage = pkg;
        btnPayQris.disabled = false;
        btnPayQris.innerHTML = '<span>Pay Rp ' + Number(pkg.price).toLocaleString('id-ID') + ' with QRIS</span>';
      });

      packageContainer.appendChild(card);
    });
  }

  // Create QRIS Payment
  if (btnPayQris) {
    btnPayQris.addEventListener('click', async function () {
      if (!selectedPackage) return;
      btnPayQris.disabled = true;
      btnPayQris.innerHTML = '<span>Generating QRIS...</span>';

      try {
        const phone = phoneInput ? phoneInput.value.trim() : '';
        const res = await fetch(BACKEND_URL + '/api/payment/create-qris', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            packageId: selectedPackage.id,
            phone: phone
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to initiate QRIS transaction');
        }

        const order = await res.json();
        currentOrderId = order.orderId;
        showQrScreen(order);
      } catch (err) {
        showToast('Error: ' + err.message);
        btnPayQris.disabled = false;
        btnPayQris.innerHTML = '<span>Retry Payment</span>';
      }
    });
  }

  function showQrScreen(order) {
    stepSelectPkg.style.display = 'none';
    stepShowQr.style.display = 'block';

    qrAmount.innerText = 'Rp ' + Number(order.amount).toLocaleString('id-ID');

    if (order.qrUrl) {
      qrImage.src = order.qrUrl;
    } else if (order.qrString) {
      qrImage.src = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(order.qrString);
    }

    startCountdown(15 * 60);
    startPolling(order.orderId);
  }

  function startPolling(orderId) {
    stopPolling();
    pollInterval = setInterval(async function () {
      try {
        const res = await fetch(BACKEND_URL + '/api/payment/status/' + encodeURIComponent(orderId));
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'settlement' || data.status === 'capture') {
          stopPolling();
          stopCountdown();
          showSuccessScreen(data);
        } else if (data.status === 'expire' || data.status === 'cancel') {
          stopPolling();
          stopCountdown();
          showToast('Payment expired or cancelled');
          closeModal();
        }
      } catch {
        // Polling retry
      }
    }, 3000);
  }

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  function startCountdown(durationSeconds) {
    stopCountdown();
    let remaining = durationSeconds;
    updateTimerText(remaining);

    countdownInterval = setInterval(function () {
      remaining--;
      if (remaining <= 0) {
        stopCountdown();
        stopPolling();
        showToast('Payment window expired');
        closeModal();
        return;
      }
      updateTimerText(remaining);
    }, 1000);
  }

  function stopCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  function updateTimerText(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    qrTimer.innerText = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function showSuccessScreen(data) {
    stepShowQr.style.display = 'none';
    stepSuccess.style.display = 'block';

    const voucher = data.voucher || {};
    const code = voucher.username || 'CONFIRMED';
    voucherCodeEl.innerText = code;
    voucherDurationEl.innerText = (data.packageName || 'Hotspot') + ' (' + (voucher.uptimeLimit || '') + ')';

    if (btnCopyVoucher) {
      btnCopyVoucher.onclick = function () {
        copyToClipboard(code);
        showToast('Voucher code copied to clipboard');
      };
    }

    if (btnAutoLogin) {
      btnAutoLogin.onclick = function () {
        if (inputUsername) inputUsername.value = code;
        if (inputPassword) inputPassword.value = code;
        const loginForm = document.login || document.querySelector('form[name="login"]');
        if (loginForm) {
          if (typeof window.doLogin === 'function') {
            window.doLogin();
          } else {
            loginForm.submit();
          }
        }
      };
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    if (!toast) return;
    if (toastMsg) toastMsg.innerText = msg;
    toast.classList.add('show');
    setTimeout(function () {
      toast.classList.remove('show');
    }, 3000);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Voucher Retrieval by Order ID
  const btnCheckOrder = document.getElementById('btnCheckOrder');
  if (btnCheckOrder) {
    btnCheckOrder.addEventListener('click', async function () {
      const orderId = prompt('Enter your Order ID (e.g. QRIS-XXXX-XXXX):');
      if (!orderId) return;
      try {
        const res = await fetch(BACKEND_URL + '/api/payment/status/' + encodeURIComponent(orderId.trim()));
        if (!res.ok) throw new Error('Order not found');
        const data = await res.json();
        if (data.voucher) {
          modal.classList.add('active');
          showSuccessScreen(data);
        } else {
          showToast('Order status: ' + data.status + ' (Voucher not issued)');
        }
      } catch (err) {
        showToast('Search failed: ' + err.message);
      }
    });
  }
})();
