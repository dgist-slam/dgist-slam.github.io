# Pocket VO — XFeat + LighterGlue / sparse map tracker

휴대폰 카메라 영상에서 3D 특징점을 유지하며 연속 자세를 추정하는 실험용 단안 VO입니다. 로그인 없이 정적 HTTPS 페이지에서 실행됩니다.

## 사용

- **Android AR 카메라 · 자동 K**: 지원되는 Android Chrome/ARCore에서 같은 XRView의 영상과 투영 행렬로 내부 파라미터를 얻습니다. Raw Camera Access / DOM overlay 및 사용자 권한이 필요합니다.
- **일반 카메라 · 특징점**: getUserMedia는 K를 제공하지 않으므로 기본적으로 특징점만 추적합니다. 실험 설정에서 추정 K 사용을 명시적으로 허용할 수 있지만 실제 보정값이 아닙니다.
- **합성 영상 테스트**: 실제 영상 추적·3D 초기화·PnP 경로를 실행합니다. 정답 궤적을 결과로 복사하지 않습니다.
- **IMU 연결**: 가속도·각속도·실측 수신 Hz 관측. VO에는 융합하지 않습니다.

초기화하려면 가까운 물체와 먼 배경을 함께 보며 옆으로 천천히 이동하세요. 무늬 없는 벽, 단일 평면, 제자리 회전처럼 깊이를 안정적으로 얻기 어려운 경우 초기화를 보류합니다. 초록 점은 지도에 등록된 점, 주황 점은 깊이 초기화를 기다리는 후보입니다.

위에서 본 경로는 같은 지도 내에서 일관된 **임의 스케일**을 사용합니다. 미터 단위가 아닙니다. 중지하면 카메라·센서를 해제하고 마지막 궤적을 유지합니다. 다시 시작하거나 초기화하면 새 지도를 만듭니다.

영상 추출·XR GPU readback·VO 계산을 10Hz로 제한합니다. 처리 중에는 새 작업을 쌓지 않고 최신 영상을 사용합니다. 일반 카메라 입력은 최대 30Hz, XR 화면과 IMU는 자체 주기를 유지합니다. 화면의 처리 Hz는 실제 결과 수신 속도입니다.

## 학습 매처

초기화와 추적 복구에 **XFeat + LighterGlue**를 사용합니다. LighterGlue는 XFeat의 64차원 descriptor에 맞춰 학습된 LightGlue 경량 모델입니다. 공식 가중치의 6개 레이어를 모두 사용하며 임의의 SuperPoint용 가중치를 섞지 않습니다. 모델 파일 합계 7.1MB, OpenCV/ONNX 실행 엔진까지 첫 다운로드 약 44MB입니다. 로그인·추론 서버 없이 기기 안에서 실행됩니다.

WebGPU가 가능하면 WebGPU/WASM으로 실행하고, 미지원·GPU 실행 오류 시 WASM으로 전환합니다. 화면에 실제 선택된 실행 경로, 마지막 매칭점 수와 매칭 시간을 표시합니다. 모델 로드/실행 자체가 실패하면 명시적으로 LK/ORB 대체 모드를 표시합니다. 일반 카메라에서 K가 없으면 기존과 같이 특징점만 추적합니다.

평소에는 LK/PnP 10Hz, 초기화·복구에서만 최대 2회/초의 학습 매칭을 시도합니다. 느린 추론이 끝난 후 최소 500ms를 쉬므로 실제 호출 빈도는 더 낮을 수 있습니다. WASM에서 학습 매칭 한 번이 100ms를 넘을 수 있어 초기화·복구 중 10Hz를 보장하지 않습니다. 기준 영상의 XFeat 결과는 필요할 때 계산하고 최대 6개 영상에 보관합니다.

## 알고리즘

1. VO 목표 10Hz (100ms 간격), 처리 너비 384px, Web Worker의 OpenCV.js / WASM CPU. 최대 300개 특징점을 격자별로 분산 검출.
2. 피라미드 Lucas–Kanade + 양방향 오차 + 패치 오차로 추적점 검사.
3. XFeat 키포인트/descriptor와 LighterGlue의 상호 일치·신뢰도 > 0.1 매칭을 구하고, 양방향 LK로 픽셀 위치를 보정. 회전 전용 모델 및 homography 퇴화를 검사한 뒤 두 영상으로 bootstrap. Essential matrix, cheirality, parallax, 양쪽 재투영 오차, 공간 분포 검사.
4. 초기 삼각측량한 3D 점의 중앙 깊이를 1로 정규화하고 같은 스케일의 지도를 유지.
5. 매 프레임 3D–2D PnP RANSAC + inlier 기반 반복 최적화. 재투영 오차·양의 깊이·화면 분포·과도한 자세 변화를 검사.
6. 기존 3D 점을 계속 사용하면서 새 후보를 검출하고 다중 시점에서 삼각측량해 보충.
7. 일시적 추적 실패 시 위치와 지도를 유지. 최대 6개 기준 영상을 보관하며 가장 최근 영상을 우선 검색. 큰 이동에서는 XFeat/LighterGlue 대응점 가까이의 기존 3D 지도점 관측을 연결해 LK 검색 위치를 잡고, 양방향 LK와 3D PnP로 다시 검증. 학습 대응점만으로 위치를 누적하지 않음. 모델 실패 대체 모드에서만 이전 ORB 경로를 사용.
8. 실패 프레임 수만으로 자동 재초기화하지 않음. 초기화 버튼·새 입력 시작·영상 크기 변경 시에만 새 구간 생성. 완전히 새로운 장면에서는 복구가 안 될 수 있으므로 사용자가 초기화해야 함.

이전 버전의 키프레임마다 단위 이동을 더하는 방식을 제거했습니다. 전체 landmark BA, 루프 폐쇄, 전역 재지역화, IMU 융합, 미터 단위 스케일은 포함하지 않습니다. 동적 물체·반복 무늬·롤링 셔터·자동 초점·카메라 보정 오차에 여전히 취약할 수 있습니다.

WebXR는 카메라 영상을 제공하기 위해 자체 추적을 수행하지만, **ARCore/WebXR 위치를 이 VO의 결과로 사용하지 않습니다.** 영상과 K만 사용합니다. GPU는 XR 텍스처 축소·readback과 지원되는 환경의 학습 추론에 사용합니다. LK와 기하 계산은 WASM CPU입니다. 렌즈 왜곡 계수는 이 API로 별도로 얻지 못합니다.

## 재현 검사

Node.js에서 `node tests/regression.cjs` 및 `VO_TEST_HZ=10 node tests/regression.cjs`, `node tests/recovery.cjs` 실행. 추가 패키지 설치 없이 포함된 OpenCV 런타임으로 6개 합성 영상 시나리오(이동/정지/회전/짧은 가림/추적 후 회전/긴 추적 손실)를 검사합니다. 이 검사는 LK/ORB 대체 경로입니다. 학습 모델의 실제 브라우저 검사는 아래 절차로 재현합니다. 결과와 실제 영상 오검출 검사는 VALIDATION.md에 있습니다. 성능 수치는 데스크톱 검증으로, 휴대폰 성능 보장이 아닙니다.

학습 경로 재현 (모델 변환 환경은 `tools/requirements.txt`, 공식 원본 revision은 `models/manifest.json`):

1. 공식 accelerated_features 저장소를 해당 revision으로 준비하고 Python 환경에 requirements를 설치합니다.
2. `python tools/export_models.py /path/to/accelerated_features models`로 모델 출력/원본 출력 비교를 포함해 변환합니다.
3. `node tests/generate-learned-fixtures.cjs`로 테스트 영상을 생성합니다.
4. `python tools/parity_reference.py /path/to/accelerated_features tests/generated`로 공식 PyTorch 매칭 정답을 생성합니다.
5. 로컬 페이지에서 `tests/learned-parity-browser.js`와 `tests/learned-sequence-browser.js`를 브라우저 평가로 실행합니다. 실제 WASM 모델을 사용하며, 순수 회전/정지 거부와 지도 초기화·복구를 검사합니다. 복구 검사는 저비용 LK 경로만 한 프레임 거부해 학습 경로를 강제로 선택하고, 학습 매칭과 최종 PnP는 실제 계산합니다.

## 로컬 실행

이 폴더에서 `python3 -m http.server 8765` 후 http://localhost:8765 에서 엽니다. 휴대폰 카메라·IMU에는 HTTPS 배포가 필요합니다. LAN HTTP나 HTML 더블클릭 실행은 지원하지 않습니다. 영상·센서 데이터는 외부로 전송하지 않습니다. OpenCV 약 10MB를 포함한 vendor 폴더도 배포해야 합니다.

## 출처와 라이선스

- OpenCV.js 4.10.0: Apache-2.0, vendor/LICENSE-OpenCV.txt. 배포본 @techstark/opencv-js 4.10.0-release.1.
- PnP: https://docs.opencv.org/4.x/d5/d1f/calib3d_solvePnP.html
- WebXR camera/K: https://github.com/immersive-web/raw-camera-access/blob/main/explainer.md
- Android native Camera2: https://developer.android.com/reference/android/hardware/camera2/CameraCharacteristics#LENS_INTRINSIC_CALIBRATION

- XFeat / XFeat-trained LighterGlue: https://github.com/verlab/accelerated_features (Apache-2.0). 변환된 모델, 라이선스, SHA-256은 models/에 포함.
- LightGlue: https://github.com/cvg/LightGlue (Apache-2.0), Kornia 0.8.3 (Apache-2.0).
- ONNX Runtime Web 1.30.0 (MIT): vendor/ort/. 배포된 JS와 asyncify WASM은 동일 npm 버전.
