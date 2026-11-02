(function () {
  'use strict';

  // Resolve backend API URL
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
      if (labelUsername) labelUsername.innerText = 'Kode Voucher';
      if (inputUsername) inputUsername.placeholder = 'Masukkan kode voucher';
    });

    tabMember.addEventListener('click', function () {
      tabMember.classList.add('active');
      tabVoucher.classList.remove('active');
      if (groupPassword) groupPassword.style.display = 'block';
      if (labelUsername) labelUsername.innerText = 'Username';
      if (inputUsername) inputUsername.placeholder = 'Masukkan username';
    });
  }

  // Open / Close Modal
  if (btnOpenModal) {
    btnOpenModal.addEventListener('click', function () {
      resetModalState();
      modal.classList.add('active');
      fetchPackages();
    });
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', function () {
      closeModal();
    });
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
    btnPayQris.innerText = 'Lanjut ke Pembayaran QRIS';
  }

  // Fetch packages from backend
  async function fetchPackages() {
    try {
      packageContainer.innerHTML = '<p style="text-align:center;font-size:0.85rem;color:#64748b;">Memuat paket...</p>';
      const res = await fetch(BACKEND_URL + '/api/packages');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      activePackages = data.packages || [];
      renderPackages(activePackages);
    } catch (err) {
      console.warn('Backend unavailable, using fallback packages:', err.message);
      // Fallback offline packages
      activePackages = [
        { id: '1h', name: '1 Jam', price: 2000, uptime_limit: '1h' },
        { id: '3h', name: '3 Jam', price: 5000, uptime_limit: '3h' },
        { id: '1d', name: '1 Hari', price: 10000, uptime_limit: '1d' },
        { id: '7d', name: '7 Hari', price: 35000, uptime_limit: '7d' }
      ];
      renderPackages(activePackages);
    }
  }

  function renderPackages(packages) {
    packageContainer.innerHTML = '';
    packages.forEach(function (pkg) {
      const item = document.createElement('div');
      item.className = 'package-item';
      item.innerHTML =
        '<div class="pkg-name">' + escapeHtml(pkg.name) + '</div>' +
        '<div class="pkg-price">Rp ' + Number(pkg.price).toLocaleString('id-ID') + '</div>' +
        '<div class="pkg-time">Aktif: ' + escapeHtml(pkg.uptime_limit || pkg.uptimeLimit || '') + '</div>';

      item.addEventListener('click', function () {
        document.querySelectorAll('.package-item').forEach(function (el) {
          el.classList.remove('selected');
        });
        item.classList.add('selected');
        selectedPackage = pkg;
        btnPayQris.disabled = false;
        btnPayQris.innerText = 'Bayar Rp ' + Number(pkg.price).toLocaleString('id-ID') + ' via QRIS';
      });

      packageContainer.appendChild(item);
    });
  }

  // Initiate QRIS Payment
  if (btnPayQris) {
    btnPayQris.addEventListener('click', async function () {
      if (!selectedPackage) return;
      btnPayQris.disabled = true;
      btnPayQris.innerText = 'Menyiapkan QRIS...';

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
          throw new Error(errData.error || 'Gagal membuat QRIS');
        }

        const order = await res.json();
        currentOrderId = order.orderId;

        // Display QRIS
        showQrScreen(order);
      } catch (err) {
        alert('Terjadi kesalahan: ' + err.message);
        btnPayQris.disabled = false;
        btnPayQris.innerText = 'Coba Lagi';
      }
    });
  }

  function showQrScreen(order) {
    stepSelectPkg.style.display = 'none';
    stepShowQr.style.display = 'block';

    qrAmount.innerText = 'Rp ' + Number(order.amount).toLocaleString('id-ID');

    // Display QR image: use qrUrl or Google Chart QR / SVG generator from qrString
    if (order.qrUrl) {
      qrImage.src = order.qrUrl;
    } else if (order.qrString) {
      qrImage.src = 'https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=' + encodeURIComponent(order.qrString);
    }

    startCountdown(15 * 60); // 15 minutes
    startPolling(order.orderId);
  }

  // Polling payment status
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
          alert('Pembayaran telah kedaluwarsa atau dibatalkan.');
          closeModal();
        }
      } catch (err) {
        // network polling retry
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
        alert('Waktu pembayaran habis.');
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
    const code = voucher.username || 'TERBAYAR';
    voucherCodeEl.innerText = code;
    voucherDurationEl.innerText = (data.packageName || '') + ' (' + (voucher.uptimeLimit || '') + ')';

    // Copy Voucher button
    if (btnCopyVoucher) {
      btnCopyVoucher.onclick = function () {
        copyToClipboard(code);
        showToast('Kode voucher berhasil disalin!');
      };
    }

    // Auto Login button
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
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.innerText = msg;
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

  // Check voucher by Order ID
  const btnCheckOrder = document.getElementById('btnCheckOrder');
  if (btnCheckOrder) {
    btnCheckOrder.addEventListener('click', async function () {
      const orderId = prompt('Masukkan Order ID Anda (contoh: QRIS-XXXX-XXXX):');
      if (!orderId) return;
      try {
        const res = await fetch(BACKEND_URL + '/api/payment/status/' + encodeURIComponent(orderId.trim()));
        if (!res.ok) throw new Error('Order tidak ditemukan');
        const data = await res.json();
        if (data.voucher) {
          modal.classList.add('active');
          showSuccessScreen(data);
        } else {
          alert('Status order: ' + data.status + ' (Belum ada voucher)');
        }
      } catch (err) {
        alert('Gagal mencari voucher: ' + err.message);
      }
    });
  }
})();
