#!/usr/bin/env bash
# tests/e2e/idor-two-tenants.sh — ΜΟΝΟ για ΤΟΠΙΚΗ βάση (ποτέ preview/production:
# γράφει/σβήνει αν βρει τρύπα). Ο Διαχειριστής της εταιρίας Β δοκιμάζει ids
# της εταιρίας Α σε όλα τα routes με [id] και σε σώματα αιτημάτων.
# Αναμενόμενο: 404 / 400 / 405 παντού — ΠΟΤΕ 200 με δεδομένα της Α.
#
# Χρήση: BASE=http://localhost:3100 COOKIE_B=./cookie-jar-of-tenant-B \
#   B=<bookingId Α> C=<contractId Α> CU=<customerId Α> D=<discountId Α> \
#   X=<extraId Α> V=<vehicleId Α> U=<userId Α> G=<rentalGroupId Α> \
#   L=<pickupLocationId Α> P=<placeId Α> R=<reviewId Α> \
#   bash tests/e2e/idor-two-tenants.sh
set -u
BASE=${BASE:-http://localhost:3100}
fail=0
r() {
  local code body
  code=$(curl -s -b "$COOKIE_B" -o /tmp/idor_body -w %{http_code} -X "$1" -H "content-type: application/json" ${3:+-d "$3"} "$BASE/api$2")
  body=$(head -c 90 /tmp/idor_body | tr '\n' ' ')
  case "$code" in 2*) echo "❌ $1 $2 → $code $body"; fail=1 ;; *) echo "✅ $1 $2 → $code" ;; esac
}
r PATCH /bookings/$B '{"notes":"x"}'; r DELETE /bookings/$B
r GET /bookings/$B/decision; r POST /bookings/$B/decision '{"action":"cancel","notify":false}'
r POST /bookings/$B/messages '{"kind":"confirm","channel":"whatsapp"}'
r POST /bookings/$B/retain '{}'; r POST /bookings/$B/payment-check
r GET /contracts/$C; r PATCH /contracts/$C '{"notes":"x"}'; r DELETE /contracts/$C
r GET "/contracts/$C/card-number?kind=payment"; r POST /contracts/$C/email '{"lang":"el"}'
r POST /contracts/$C/link '{"action":"renew"}'; r GET /contracts/$C/photos; r POST /contracts/$C/sign '{}'; r POST /contracts/$C/complete '{}'
r PATCH /customers/$CU '{"firstName":"x"}'; r DELETE /customers/$CU
r PATCH /discounts/$D '{"isActive":false}'; r DELETE /discounts/$D
r PATCH /extras/$X '{"name":"x"}'; r DELETE /extras/$X
r PATCH /vehicles/$V '{"notes":"x"}'; r DELETE /vehicles/$V; r GET /vehicles/$V/photos; r POST /vehicles/$V/photos/sign '{}'
r PATCH /company-users/$U '{"name":"x"}'; r DELETE /company-users/$U
r PATCH /public-site/groups/$G '{}'; r DELETE /public-site/groups/$G; r PATCH /public-site/locations/$L '{}'
r DELETE /public-site/places/$P; r DELETE /public-site/reviews/$R; r POST /public-site/places/$P/move '{"dir":"up"}'
r POST /public-site/place-photos/$P/sign '{}'
# ids της Α μέσα σε σώματα αιτημάτων:
r POST /invoices "{\"bookingId\":\"$B\"}"
r POST /contracts "{\"bookingId\":\"$B\"}"
r POST /bookings/preview "{\"vehicleId\":\"$V\",\"pickupDate\":\"2027-03-01\",\"pickupTime\":\"10:00\",\"returnDate\":\"2027-03-03\",\"returnTime\":\"10:00\"}"
r POST /bookings "{\"customerId\":\"$CU\",\"vehicleId\":\"$V\",\"pickupDate\":\"2027-03-01\",\"pickupTime\":\"10:00\",\"returnDate\":\"2027-03-03\",\"returnTime\":\"10:00\",\"dailyRate\":10,\"totalDays\":2,\"subtotal\":20,\"total\":20}"
exit $fail
