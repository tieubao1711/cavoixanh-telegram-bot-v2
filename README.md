# Payment Telegram Bot

Bot Telegram Node.js rieng cho cong thanh toan. Bot dung `node-telegram-bot-api`, chay polling va giu cac lenh:

- `/naptien`
- `/ruttien`
- `/danhsachrut`
- `/thongke`
- `/chotdoanhthu`
- `/lichsuchot`

Trong group bot nhan ca dang co username, vi du `/naptien@BotUsername 50000`.

## Cai dat

```bash
npm install
```

## Cau hinh

Tao file `.env` tu `.env.example`:

```bash
cp .env.example .env
```

Bien moi truong:

- `TELEGRAM_BOT_TOKEN`: token bot Telegram.
- `API_BASE_URL`: base URL chung neu can.
- `REQUEST_TIMEOUT_MS`: timeout goi API.
- `ALLOWED_USER_IDS`: danh sach Telegram user id cach nhau bang dau phay. De trong thi ai cung dung duoc.
- `RECHARGE_API_BASE_URL`: base URL API nap/rut.
- `RECHARGE_API_KEY`: API key cong thanh toan.
- `RECHARGE_SIGN_KEY`: key ky lenh nap, neu provider yeu cau.
- `RECHARGE_CALLBACK_PASSWORD_LV2`: password lv2 dung verify callback va ky lenh rut.
- `RECHARGE_CALLBACK_PORT`: port callback server.
- `RECHARGE_CALLBACK_PATH`: path callback nap/rut.
- `RECHARGE_CALLBACK_PUBLIC_URL`: URL public cua callback, vi du `https://domain.com/recharge/callback`.
- `WITHDRAW_APPROVER_TELEGRAM_ID`: Telegram id nguoi duyet rut tien.
- `MONGODB_URI`: MongoDB connection string.
- `MONGODB_DB_NAME`: ten database.

Khong commit `.env` vi file nay chua token, API key va password.

## Chay bot

```bash
npm start
```

Bot se ket noi MongoDB, dang ky polling Telegram va mo callback/web server tren `RECHARGE_CALLBACK_PORT`.

## Chay bang PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 logs cavoixanh-telegram-bot-v2
```

Neu dung reverse proxy hoac tunnel cho callback, tro public URL toi:

```text
http://localhost:RECHARGE_CALLBACK_PORT/RECHARGE_CALLBACK_PATH
```

Form rut tien nam tai:

```text
http://localhost:RECHARGE_CALLBACK_PORT/withdraw?token=...
```

## Kiem tra

Kiem tra cu phap cac file JS chinh:

```bash
npm run check
```

Chay test formatter don gian:

```bash
npm test
```
