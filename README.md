# Genius Bookings — GitHub Pages

موقع حجوزات متجاوب مع الموبايل ومتصل بشيت Genius الحالي، دون Apps Script.

## النشر
1. أنشئ مستودع GitHub خاصًا إن أمكن؛ لو GitHub Pages المجاني عندك يحتاج مستودعًا عامًا، انتبه أن ملفات الموقع ستكون عامة **لكن بيانات الحجوزات لا تُخزَّن في المستودع**.
2. ارفع `index.html` و`app.js` و`style.css` و`.nojekyll` إلى جذر المستودع.
3. من Settings → Pages اختر Deploy from a branch → main → /(root)، وانتظر رابط HTTPS.
4. في Google Cloud Console، أنشئ مشروعًا أو استخدم مشروعًا مناسبًا، وفعّل **Google Sheets API**. اضبط OAuth consent screen (External أو Internal حسب نوع الحساب)، وأضف `bodeyamal@gmail.com` كـ test user لو التطبيق في وضع Testing.
5. أنشئ OAuth Client ID من نوع **Web application**. أضف عنوان موقع GitHub Pages النهائي إلى **Authorized JavaScript origins** بالشكل `https://USERNAME.github.io` (بدون مسار المستودع). لا تحتاج Client Secret على المتصفح.
6. افتح الموقع، أدخل OAuth Client ID، ثم سجّل الدخول بحساب Genius المصرح له. يجب أن يظل الحساب له صلاحية تحرير الشيت.

## وظائف
- إضافة حجز وتعديل بياناته، مع فحص تداخل الأوقات.
- حذف مع تأكيد وأرشفة نسخة في `Deleted Bookings`.
- الداشبورد والشهور والعربون والمتبقي.
- معاينة تجريبية دون حفظ أي بيانات على Google Sheets.

## ملاحظات أمنية وتشغيلية
- Google OAuth يتحقق من هوية الحساب على جهة Google، لكن شرط البريد الإلكتروني في JavaScript **ليس طبقة صلاحيات أمنية**. صلاحيات Google Sheets الفعلية هي التي تتحكم في القراءة والكتابة. لا تجعل الشيت عامًا أو متاحًا لأي شخص لديه الرابط.
- لا تضع OAuth Client Secret أو Google API Key أو رمز وصول في المستودع. Client ID وحده ليس سرًا.
- GitHub Pages استضافة ثابتة؛ إعداد OAuth وموافقة Google مطلوبان قبل الاتصال الحقيقي.
- لا تختبر الحذف على بيانات العملاء الحقيقية قبل أخذ نسخة احتياطية من الشيت.
- استخدام الحساب من أجهزة متعددة يحتاج تحديث البيانات قبل التعديل؛ تجنب تعديل نفس الحجز بالتزامن.