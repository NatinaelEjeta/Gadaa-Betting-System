/**
 * API contract cheat-sheet for frontend components.
 * Envelope: { ok: true, data } | { ok: false, error, code }
 * Money: integer cents everywhere (format with formatETB()).
 *
 * AUTH
 *   POST /api/auth/register   {fullName, phone, password, dateOfBirth, referralCode?} → {devOtp?}
 *   POST /api/auth/login      {phone, password} → sets session cookie
 *   POST /api/auth/logout
 *   GET  /api/auth/me         → {user: UserDTO|null} (incl. wallet, kycStatus, usage)
 *   POST /api/auth/otp/send   {phone, purpose: PHONE_VERIFY|PASSWORD_RESET} → {devOtp?}
 *   POST /api/auth/otp/verify {phone, code}
 *   POST /api/auth/forgot-password {phone} → {devOtp?}
 *   POST /api/auth/reset-password  {phone, code, newPassword}
 *
 * KYC / PROFILE
 *   GET  /api/kyc → {documents[]}
 *   POST /api/kyc {docType, docNumber, dateOfBirth, frontImage(dataURL), backImage?}
 *   PUT  /api/profile {fullName?, language?}
 *   PUT  /api/profile/limits {dailyDepositLimitCents?, dailyStakeLimitCents?, lossLimitCents?, coolingOffHours?}
 *   POST /api/profile/limits {days: 1|7|30|90|365, reason?}
 *
 * WALLET / PAYMENTS
 *   GET  /api/wallet → {wallet, settings(min/max...), usage}
 *   GET  /api/wallet/transactions?type=&page= → {transactions[], total, page, totalPages}
 *   POST /api/deposits {amountCents} → {checkoutUrl, txRef}   (test mode: redirect user to checkoutUrl)
 *   GET  /api/withdrawals → {withdrawals[]}
 *   POST /api/withdrawals {amountCents, method: TELEBIRR|CBE_BIRR|BANK, accountName, accountNumber, bankName?}
 *
 * SPORTSBOOK
 *   GET  /api/sports → [{id, key, name, leagues: [{id, name, country, eventsCount}]}]
 *   GET  /api/events?sport=&league=&status=LIVE|SCHEDULED|FINISHED&featured=1&q=&page=&pageSize=
 *        → {events: EventDTO[], total, page, totalPages}
 *   GET  /api/events/:id → {event: EventDTO}
 *
 * BETS
 *   GET  /api/bets?filter=OPEN|SETTLED|ALL&page= → {bets: BetDTO[], total...}
 *   POST /api/bets {type: SINGLE|MULTIPLE|SYSTEM, stakeCents, selectionIds[], systemK?, acceptOddsChange?}
 *        → {bet: BetDTO}  |  error codes: SELECTION_SUSPENDED, INSUFFICIENT_FUNDS, MIN_STAKE, SAME_MARKET...
 *   GET  /api/bets/:id/cashout → {offerCents|null}
 *   POST /api/bets/:id/cashout → {offerCents, bet}
 *
 * NOTIFICATIONS
 *   GET  /api/notifications → {notifications[], unread}
 *   POST /api/notifications {ids?} — mark read
 *
 * ADMIN (role-gated; see each route for role lists)
 *   GET/PATCH /api/admin/users, /api/admin/users/:id
 *   GET /api/admin/kyc?status=, POST /api/admin/kyc/:id {action: APPROVE|REJECT, note?}
 *   GET /api/admin/withdrawals?status=, POST /api/admin/withdrawals/:id {action, note?}
 *   GET/POST /api/admin/events, PATCH/POST /api/admin/events/:id (PATCH=update, POST=settle {homeScore, awayScore})
 *   PATCH /api/admin/markets/:id {status?, resultName?}
 *   PATCH /api/admin/selections/:id {odds?, status?}
 *   GET /api/admin/bets?status=&userId=, POST /api/admin/bets/:id/settle {outcome: WON|LOST|VOID, payoutCents?}
 *   GET /api/admin/reports?range=7|28|180 → {days[], totals}
 *   GET /api/admin/audit-logs?action=&page=
 *   GET/POST /api/admin/bonuses, POST /api/admin/bonuses/grant {userId, amountCents, reason?}
 *   GET/PUT /api/admin/settings
 *
 * REALTIME (socket.io, "/?XTransformPort=3003", path "/")
 *   client → emit subscribe {room}: "live" | "catalog" | "event:{id}" | "user:{uid}"
 *   server → score_update {eventId, homeScore, awayScore, minute, status, lastEvent, marketsSuspended}
 *            odds_update {eventId, markets: [{marketId, selections: [{selectionId, odds, prevOdds, status}]}]}
 *            event_status {eventId, status}
 *            markets_reopened {eventId}
 *            catalog_update {reason}
 *            notify {kind, message}   (only in user:{uid} room)
 */
export {};
