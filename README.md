# R9CLUB AUTOMIX

โปรแกรม Windows สำหรับนำเพลงที่เตรียมหัวและท้ายไว้แล้วมาวางต่อกันแบบหลาย Track โดยระบบจะวิเคราะห์ `IN` และ `OUT` แล้วจัด Anchor ให้ตรงกันอัตโนมัติ ไม่มีการเพิ่ม Fade หรือ Crossfade ใหม่

![R9CLUB AUTOMIX](src/assets/r9club-logo.png)

## การใช้งาน

1. กด **เพิ่มเพลง** แล้วเลือกไฟล์เสียงหลายไฟล์ตามลำดับที่ต้องการ
2. กำหนด BPM และจำนวนห้องก่อน `IN` ให้ตรงกับรูปแบบไฟล์ที่เตรียมไว้
3. โปรแกรมจะตรวจ `OUT` ของเพลงก่อนหน้าและวาง `IN` ของเพลงถัดไปให้ตรงกัน
4. ลาก Timeline ซ้าย-ขวาเพื่อดู waveform และใช้ปุ่มหรือ slider เพื่อ Zoom
5. เลือกเพลงแล้วลาก handle ที่ขอบซ้ายหรือขวาของ waveform เมื่อต้องการตัดหัว/ท้าย
6. เลือกเพลงใน Timeline เพื่อปรับ `IN` หรือ `OUT` แบบละเอียด
7. กด **EXPORT** เพื่อสร้าง WAV 32-bit Float Lossless Master

เปิด **Audio Engine** จากปุ่มหูฟังบน Toolbar เพื่อเลือก Windows output, latency profile, WASAPI Exclusive หรือ ASIO driver พร้อมดู sample rate, buffer, latency และ stream interruption

โปรเจกต์บันทึกเป็นไฟล์ `.beatblend` และเปิดกลับมาแก้ไขภายหลังได้

## ตรวจงานและกู้คืน

- **Transition Audition** เลือกเพลงปลายทาง กำหนด 8 หรือ 16 ห้อง แล้วกดปุ่ม Loop เพื่อฟังช่วงเชื่อมซ้ำ
- **Undo / Redo** ย้อนค่า Trim, Anchor, การเพิ่ม/ลบ และลำดับเพลงได้สูงสุด 40 ขั้น
- **Quality Check** ตรวจ Beat Drift, จุด Trim ที่เสี่ยง Click, source clipping และ peak ของช่วงเสียงซ้อนก่อน Export
- **Autosave / Recovery** โปรแกรม Windows บันทึกงานเบื้องหลังและเสนอการกู้คืนเมื่อเปิดครั้งถัดไป
- **Disk Space Guard** คำนวณขนาด WAV และตรวจพื้นที่ไดรฟ์ปลายทางก่อนเริ่ม Render
- **Post-render Verification** เปิดอ่าน Master ที่สร้างเสร็จเพื่อตรวจ codec, sample rate, channel, duration, peak, sample count และขนาดไฟล์จริง

## Quality Lock

- Playback ปกติใช้ AudioContext ที่ sample rate สูงสุดและส่งสัญญาณตรงโดยไม่เพิ่ม gain, fade หรือ loudness processing
- ASIO ใช้ native NAudio backend รับ PCM float32 จาก FFmpeg โดยตรง ส่วน WASAPI Exclusive ใช้ native Windows Core Audio และจะเปิดเฉพาะเมื่อ driver รองรับ format/sample rate ของโปรเจกต์
- Render ผสมเสียงภายในแบบ double precision และใช้ high-quality resampling เฉพาะเมื่อ sample rate ของไฟล์ต่างกัน
- ไฟล์ปลายทางล็อกเป็น WAV 32-bit Float ที่ sample rate สูงสุดของชุดเพลง ไม่มี MP3 re-encode และไม่มีการลด bit depth
- รองรับไฟล์ต้นทาง Mono/Stereo เท่านั้น เพื่อไม่ Downmix ไฟล์หลาย channel โดยไม่ตั้งใจ

## คีย์ลัด

| คำสั่ง | ปุ่ม |
| --- | --- |
| เล่น / หยุดชั่วคราว | `Space` |
| หยุดเล่น | `Esc` |
| กลับจุดเริ่มต้น | `Home` |
| เลื่อน 1 ห้อง | `Left` / `Right` |
| เลื่อน 4 ห้อง | `Shift + Left` / `Shift + Right` |
| Zoom Timeline | `+` / `-` |
| Zoom ตรงตำแหน่งเมาส์ | `Ctrl + Mouse Wheel` |
| ทดลองช่วงเชื่อมแบบวน | `L` |
| ย้อนกลับ | `Ctrl + Z` |
| ทำซ้ำ | `Ctrl + Y` / `Ctrl + Shift + Z` |
| เพิ่มเพลง | `Ctrl + Shift + O` |
| เปิดโปรเจกต์ | `Ctrl + O` |
| บันทึกโปรเจกต์ | `Ctrl + S` |
| Export Mix | `Ctrl + E` |
| ลบเพลงที่เลือก | `Delete` |
| แสดงคีย์ลัดทั้งหมด | `?` |

## Web Preview

รัน `npm run dev:web` แล้วเปิด `http://127.0.0.1:5173` เว็บรองรับการเลือกไฟล์จริงเพื่อทดสอบการจัดเพลง การเล่นต่อเนื่อง Zoom และลากดู waveform ส่วนการบันทึกโปรเจกต์และการเขียนไฟล์ Master ใช้ในโปรแกรม Windows

เปิด `http://127.0.0.1:5173/?demo=1&render=1` เพื่อทดลองหน้า Render โดยไม่เขียนไฟล์จริง

## พัฒนาและสร้างตัวติดตั้ง

```powershell
npm install
npm run dev
npm test
npm run smoke:audio
npm run smoke:native
npm run dist
```

ตัวติดตั้งอยู่ที่ `release/R9CLUB-AUTOMIX-Setup-0.7.0.exe` และรวม FFmpeg, WASAPI helper, ASIO helper และ .NET runtime ที่จำเป็นไว้แล้ว
