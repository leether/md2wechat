Place your QR code image here as `footer-qr.png`.

Then configure in `.env`:
```
FOOTER_QR_PATH=<PIPELINE_HOME>/assets/footer-qr.png
FOOTER_CTA=你的 CTA 文案
FOOTER_QR_TITLE=群名称
FOOTER_QR_HINT=扫码加入
```

If you don't need a footer QR code, simply leave this directory empty —
the renderer will skip the footer section without errors.
