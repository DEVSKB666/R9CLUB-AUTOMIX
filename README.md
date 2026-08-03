# R9CLUB AUTOMIX

โปรแกรม Desktop สำหรับ Windows และ macOS เพื่อนำเพลงที่เตรียมหัวและท้ายไว้แล้วมาวางต่อกันแบบหลาย Track โดยระบบจะวิเคราะห์ `IN` และ `OUT` แล้วจัด Anchor ให้ตรงกันอัตโนมัติ ไม่มีการเพิ่ม Fade หรือ Crossfade ใหม่

![R9CLUB AUTOMIX](src/assets/r9club-logo.png)

## การใช้งาน

1. กด **เพิ่มเพลง** แล้วเลือกไฟล์เสียงหลายไฟล์ตามลำดับที่ต้องการ
2. กำหนด BPM และจำนวนห้องก่อน `IN` ให้ตรงกับรูปแบบไฟล์ที่เตรียมไว้
3. โปรแกรมจะตรวจ `OUT` ของเพลงก่อนหน้าและวาง `IN` ของเพลงถัดไปให้ตรงกัน
4. ลาก Timeline ซ้าย-ขวาเพื่อดู waveform และใช้ปุ่มหรือ slider เพื่อ Zoom
5. เลือกเพลงแล้วลาก handle ที่ขอบซ้ายหรือขวาของ waveform เมื่อต้องการตัดหัว/ท้าย
6. เลือกเพลงใน Timeline เพื่อปรับ `IN` หรือ `OUT` แบบละเอียด
7. กด **EXPORT** แล้วเลือก WAV 32-bit Float, FLAC 24-bit Lossless หรือ MP3 พร้อม bitrate 128–320 kbps

WAV เป็นค่าเริ่มต้นและรักษาคุณภาพสูงสุดของระบบ ส่วน FLAC บีบอัดแบบ Lossless เพื่อให้ไฟล์เล็กลง สำหรับ MP3 เป็นไฟล์ Lossy ตามข้อจำกัดของมาตรฐาน แนะนำ 320 kbps เมื่อต้องการคุณภาพ MP3 สูงสุด

เปิด **Audio Engine** จากปุ่มหูฟังบน Toolbar เพื่อเลือก output และ latency profile พร้อมดู sample rate, buffer, latency และ stream interruption โดย Windows รองรับ WASAPI Shared, WASAPI Exclusive และ ASIO ส่วน macOS ใช้ Chromium/Core Audio Shared

โปรเจกต์บันทึกเป็นไฟล์ `.beatblend` และเปิดกลับมาแก้ไขภายหลังได้

## ตรวจงานและกู้คืน

- **Transition Audition** เลือกเพลงปลายทาง กำหนด 8 หรือ 16 ห้อง แล้วกดปุ่ม Loop เพื่อฟังช่วงเชื่อมซ้ำ
- **Undo / Redo** ย้อนค่า Trim, Anchor, การเพิ่ม/ลบ และลำดับเพลงได้สูงสุด 40 ขั้น
- **Quality Check** ตรวจ Beat Drift, จุด Trim ที่เสี่ยง Click, source clipping และ peak ของช่วงเสียงซ้อนก่อน Export
- **Autosave / Recovery** โปรแกรม Windows บันทึกงานเบื้องหลังและเสนอการกู้คืนเมื่อเปิดครั้งถัดไป
- **Disk Space Guard** คำนวณขนาด WAV และตรวจพื้นที่ไดรฟ์ปลายทางก่อนเริ่ม Render
- **Post-render Verification** เปิดอ่าน Master ที่สร้างเสร็จเพื่อตรวจ codec, sample rate, channel, duration, peak, sample count และขนาดไฟล์จริง
- **Music DNA Analysis** ตรวจ BPM แบบหลาย onset band, แสดง half/double-tempo candidates และ confidence
- **Key / Camelot / Tuning** ตรวจ 24 Major/Minor keys, Camelot code และความคลาดเคลื่อนจาก A=440 เป็น cents
- **Beat-aligned Chord Timeline** วิเคราะห์คอร์ดตาม beat grid พร้อม sequence smoothing, key-change segments และ confidence gate
- **Manual Verification** ผู้ใช้ยืนยัน BPM และ Key ได้ ค่าที่แก้จะถูกบันทึกในโปรเจกต์และไม่ถูกแทนด้วยค่าความมั่นใจต่ำ

## Quality Lock

- Playback ปกติใช้ AudioContext ที่ sample rate สูงสุดและส่งสัญญาณตรงโดยไม่เพิ่ม gain, fade หรือ loudness processing
- ASIO ใช้ native NAudio backend รับ PCM float32 จาก FFmpeg โดยตรง ส่วน WASAPI Exclusive ใช้ native Windows Core Audio และจะเปิดเฉพาะเมื่อ driver รองรับ format/sample rate ของโปรเจกต์
- Render ผสมเสียงภายในแบบ double precision และใช้ high-quality resampling เฉพาะเมื่อ sample rate ของไฟล์ต่างกัน
- การวิเคราะห์ Music DNA ทำงานใน Web Worker จึงไม่หยุด playback/UI และใช้ FFT engine ที่เป็น MIT
- WAV ล็อกเป็น 32-bit Float ที่ sample rate สูงสุดของชุดเพลง และ FLAC ใช้ 24-bit Lossless Compression
- MP3 เลือก CBR 128, 192, 256 หรือ 320 kbps ได้ โดยหน้าจอ Export จะแจ้งชัดเจนว่าเป็น Lossy และไม่ใช้คำว่า Quality Lock
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

```text
npm install
npm run dev
npm test
npm run smoke:audio
npm run smoke:native
npm run dist
```

`npm run dist` จะเลือกแพลตฟอร์มของเครื่องอัตโนมัติ:

- Windows: สร้าง `release/R9CLUB-AUTOMIX-Setup-0.7.0.exe` พร้อม FFmpeg, WASAPI helper, ASIO helper และ .NET runtime
- macOS: สร้าง `.dmg` และ `.zip` แยกตามสถาปัตยกรรมของเครื่อง พร้อม FFmpeg สำหรับ macOS

ใช้ `npm run dist:win` บน Windows หรือ `npm run dist:mac` บน macOS เมื่อต้องการระบุแพลตฟอร์มโดยตรง ไม่ควร cross-build เพราะ FFmpeg และ native audio helper เป็น binary คนละแพลตฟอร์ม

Workflow `.github/workflows/release.yml` จะ build Windows x64, macOS Apple Silicon และ macOS Intel เมื่อสั่ง Run workflow หรือ push tag เช่น `v0.7.0` หากเป็น tag ระบบจะนำตัวติดตั้งทั้งหมดขึ้น GitHub Release อัตโนมัติ

แพ็กเกจ macOS ที่ยังไม่ได้ลงนามด้วย Apple Developer ID อาจต้องคลิกขวาแล้วเลือก **Open** ครั้งแรก สามารถเพิ่ม certificate/notarization secrets ใน GitHub Actions ภายหลังสำหรับการแจกจ่ายสาธารณะ
