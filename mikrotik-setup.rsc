# ==============================================================================
# MikroTik RouterOS Setup Script: Hotspot Walled Garden & REST API Configuration
# ==============================================================================
# Use this script on your MikroTik router (RouterOS v7 recommended) to allow
# unauthenticated hotspot users to access the QRIS payment gateway and backend.
#
# Replace YOUR_BACKEND_IP with the local or public IP of your Express Docker host.
# Example: 192.168.88.2
# ==============================================================================

:local BackendIP "192.168.88.2"

# ------------------------------------------------------------------------------
# 1. Walled Garden Rules: Allow Backend Server
# ------------------------------------------------------------------------------
/ip hotspot walled-garden ip
add action=accept dst-address=$BackendIP comment="QRIS-Backend-Server"

# ------------------------------------------------------------------------------
# 2. Walled Garden Rules: Allow Midtrans & Payment Hosts
# ------------------------------------------------------------------------------
/ip hotspot walled-garden
add action=allow dst-host=api.midtrans.com comment="Midtrans Production API"
add action=allow dst-host=api.sandbox.midtrans.com comment="Midtrans Sandbox API"
add action=allow dst-host=app.midtrans.com comment="Midtrans App Production"
add action=allow dst-host=app.sandbox.midtrans.com comment="Midtrans App Sandbox"
add action=allow dst-host=api.qrserver.com comment="QR Code Generator CDN"

# ------------------------------------------------------------------------------
# 3. Enable RouterOS REST API (RouterOS v7)
# ------------------------------------------------------------------------------
/ip service
set www disabled=no port=80
# set www-ssl disabled=no port=443

# Optional: Dedicated user for REST API voucher provisioning
# /user add name=qris-backend group=full password="ReplaceWithStrongPassword" comment="User for Express QRIS Backend"

# ------------------------------------------------------------------------------
# 4. Example Hotspot User Profiles (Matched to Default Packages)
# ------------------------------------------------------------------------------
/ip hotspot user profile
add name="1-hour" shared-users=1 rate-limit="2M/5M" keepalive-timeout=2m comment="Paket 1 Jam"
add name="3-hours" shared-users=1 rate-limit="2M/5M" keepalive-timeout=2m comment="Paket 3 Jam"
add name="1-day" shared-users=1 rate-limit="3M/10M" keepalive-timeout=5m comment="Paket 1 Hari"
add name="7-days" shared-users=1 rate-limit="5M/15M" keepalive-timeout=10m comment="Paket 7 Hari"

:put "MikroTik Hotspot QRIS configuration completed successfully!"
