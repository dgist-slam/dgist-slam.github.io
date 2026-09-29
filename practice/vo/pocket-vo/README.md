# Pocket VO

휴대폰 카메라로 특징점을 추적하고 두 영상 간 상대 자세를 추정하는 실험용 웹 앱입니다.

## 실행

이 폴더를 정적 웹 서버로 제공하세요. 개발 PC에서는 `python3 -m http.server 8765` 후 http://localhost:8765 에서 엽니다. 휴대폰 카메라·IMU에는 **HTTPS 배포**가 필요합니다. PC의 LAN HTTP 주소나 HTML 파일 더블클릭으로는 제대로 동작하지 않습니다.

- **카메라 시작**: 후면 카메라를 우선 요청, 처리 너비 384px, 최대 목표 30Hz (실측 성능은 기기에 따름).
- **합성 영상 테스트**: 깊이가 다른 3D 점을 렌더링하고 실제 영상 처리 경로로 추적. 정답 경로를 궤적으로 복사하지 않음.
- **IMU 연결**: 사용자 클릭 시 iOS 권한 요청, 가속도/각속도/중력 포함 가속도와 관측 수신 주기 표시. 일부 기기에서는 null 또는 이벤트 미제공.
- 중지/탭 숨김 시 카메라 트랙, 센서 리스너 해제.

## 구현 및 한계

OpenCV.js 4.10.0, WASM CPU, Web Worker. WebGL/WebGPU 가속이 아님. Shi–Tomasi 220점, 피라미드 LK 양방향 검사, normalized eight-point RANSAC, essential decomposition, cheirality 및 parallax 검사. 일반 getUserMedia는 K를 제공하지 않아 기본적으로 특징점 추적만 합니다. 사용자가 시야각 추정 K 사용을 명시적으로 켠 경우에만 기존 FOV 근사를 사용합니다. Android WebXR Raw Camera Access 경로는 동일 XRView의 투영 행렬과 카메라 영상을 함께 사용합니다. 별도 렌즈 왜곡 계수는 제공되지 않습니다.

이것은 **두 영상 기반 VO 프로토타입**이며 완전한 SLAM/VIO가 아닙니다. Translation direction을 키프레임마다 단위 길이로 누적하므로 전역 metric scale뿐 아니라 구간 간 상대 이동 크기도 복원하지 못합니다. 표시 경로는 이동 방향 진단용입니다. BA, 재지역화, 루프 폐쇄, persistent 3D map 없음. 정지/순수 회전/평면/움직이는 물체에서 퇴화 및 오검출 가능. 검증 실패 시 위치 갱신 보류. 추적 손실 후 기준 프레임 재설정 구간은 위치 연속성이 보장되지 않습니다.

IMU는 **표시만** 하며 영상 자세에 융합하지 않습니다. 브라우저 event timestamp와 카메라 노출 시각의 정밀 동기화 및 extrinsic calibration을 확보하지 않았습니다.

영상·IMU는 서버로 전송하지 않습니다. OpenCV 런타임은 이 폴더에 포함되어 있습니다 (약 10MB). 배포 시 vendor 폴더 포함 필요.

## 라이선스

OpenCV: Apache-2.0. 배포본 출처: https://www.npmjs.com/package/@techstark/opencv-js (4.10.0-release.1), https://github.com/opencv/opencv . vendor/LICENSE-OpenCV.txt 참고.

## Android 자동 내부 파라미터

`Android AR 카메라 · 자동 K`는 `immersive-ar`, `camera-access`, `dom-overlay`를 요청합니다. Android Chrome / ARCore 및 기능 지원 기기가 필요합니다. `isSessionSupported`와 API 존재 여부를 먼저 확인하되 실제 Raw Camera 권한/기능 여부는 세션 생성 시 검증합니다. 자동으로 일반 카메라나 추정 K로 대체하지 않습니다.

매 프레임 `XRView.camera`의 영상 텍스처와 `XRView.projectionMatrix`를 읽습니다. 다른 getUserMedia 영상에 XR 내부 행렬을 적용하지 않습니다. WebGL에서 384px로 축소한 후 위쪽 행 우선의 CPU 영상으로 읽어 worker에 전달합니다. OpenGL에서 CV 좌표(x 오른쪽, y 아래, z 전방)로 변환하며, 주점의 반 픽셀 및 skew 부호를 반영합니다. 키프레임과 현재 프레임의 K를 각각 저장해 정규화합니다. 영상 크기가 바뀌면 추적을 재설정합니다.

XR 런타임의 추적은 카메라 영상을 얻기 위해 동작하지만 **WebXR/ARCore 위치를 자체 VO 궤적으로 사용하지 않습니다.** VO 연산은 여전히 WASM CPU입니다. AR 세션+GPU readback 비용으로 일반 카메라 모드보다 느릴 수 있습니다.

공식 근거:
- https://github.com/immersive-web/raw-camera-access/blob/main/explainer.md
- https://developer.android.com/reference/android/hardware/camera2/CameraCharacteristics#LENS_INTRINSIC_CALIBRATION
- https://developers.google.com/ar/reference/java/com/google/ar/core/CameraIntrinsics
