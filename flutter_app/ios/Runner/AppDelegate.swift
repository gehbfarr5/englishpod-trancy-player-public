import AVFoundation
import Flutter
import MediaPlayer
import UIKit

private final class SystemAppearanceObserverView: UIView {
  var onTraitChanged: (() -> Void)?

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if previousTraitCollection?.userInterfaceStyle != traitCollection.userInterfaceStyle {
      onTraitChanged?()
    }
  }
}

private final class EpQrScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  var onComplete: ((String?) -> Void)?

  private let session = AVCaptureSession()
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private var hasCompleted = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black

    guard let videoDevice = AVCaptureDevice.default(for: .video),
          let videoInput = try? AVCaptureDeviceInput(device: videoDevice),
          session.canAddInput(videoInput) else {
      finish(with: nil)
      return
    }
    session.addInput(videoInput)

    let metadataOutput = AVCaptureMetadataOutput()
    guard session.canAddOutput(metadataOutput) else {
      finish(with: nil)
      return
    }
    session.addOutput(metadataOutput)
    metadataOutput.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
    if metadataOutput.availableMetadataObjectTypes.contains(.qr) {
      metadataOutput.metadataObjectTypes = [.qr]
    }

    let preview = AVCaptureVideoPreviewLayer(session: session)
    preview.videoGravity = .resizeAspectFill
    preview.frame = view.bounds
    view.layer.addSublayer(preview)
    previewLayer = preview

    setupOverlay()

    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      self?.session.startRunning()
    }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    previewLayer?.frame = view.bounds
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)
    if session.isRunning {
      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        self?.session.stopRunning()
      }
    }
  }

  private func setupOverlay() {
    let finderBox = UIView()
    finderBox.translatesAutoresizingMaskIntoConstraints = false
    finderBox.backgroundColor = .clear
    finderBox.layer.borderColor = UIColor(red: 217/255.0, green: 119/255.0, blue: 87/255.0, alpha: 1).cgColor
    finderBox.layer.borderWidth = 2.5
    finderBox.layer.cornerRadius = 20
    view.addSubview(finderBox)

    let hintLabel = UILabel()
    hintLabel.translatesAutoresizingMaskIntoConstraints = false
    hintLabel.text = "将同步二维码放入框内"
    hintLabel.textColor = .white
    hintLabel.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
    hintLabel.textAlignment = .center
    view.addSubview(hintLabel)

    let cancelButton = UIButton(type: .system)
    cancelButton.translatesAutoresizingMaskIntoConstraints = false
    cancelButton.setTitle("取消", for: .normal)
    cancelButton.setTitleColor(.white, for: .normal)
    cancelButton.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .bold)
    cancelButton.backgroundColor = UIColor(white: 0.15, alpha: 0.85)
    cancelButton.layer.cornerRadius = 22
    cancelButton.contentEdgeInsets = UIEdgeInsets(top: 10, left: 28, bottom: 10, right: 28)
    cancelButton.addTarget(self, action: #selector(handleCancelTap), for: .touchUpInside)
    view.addSubview(cancelButton)

    NSLayoutConstraint.activate([
      finderBox.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      finderBox.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -24),
      finderBox.widthAnchor.constraint(equalToConstant: 240),
      finderBox.heightAnchor.constraint(equalToConstant: 240),

      hintLabel.topAnchor.constraint(equalTo: finderBox.bottomAnchor, constant: 20),
      hintLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),

      cancelButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -36),
      cancelButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      cancelButton.heightAnchor.constraint(equalToConstant: 44),
    ])
  }

  @objc private func handleCancelTap() {
    finish(with: nil)
  }

  func metadataOutput(
    _ output: AVCaptureMetadataOutput,
    didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard !hasCompleted,
          let readable = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
          let value = readable.stringValue,
          !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return
    }
    finish(with: value)
  }

  private func finish(with value: String?) {
    guard !hasCompleted else { return }
    hasCompleted = true
    if session.isRunning {
      DispatchQueue.global(qos: .userInitiated).async { [weak self] in
        self?.session.stopRunning()
      }
    }
    let callback = onComplete
    onComplete = nil
    if presentingViewController != nil {
      dismiss(animated: true) {
        callback?(value)
      }
    } else {
      callback?(value)
    }
  }
}

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var wakelockChannel: FlutterMethodChannel?
  private var qrScannerChannel: FlutterMethodChannel?
  private var appearanceObserverView: SystemAppearanceObserverView?
  private var darkArtworkImage: UIImage?
  private var lightArtworkImage: UIImage?
  private var lastConfirmedIsDark: Bool = UIScreen.main.traitCollection.userInterfaceStyle == .dark
  private var backgroundSnapshotGuardUntil: TimeInterval = 0
  private var pendingAppearanceWorkItem: DispatchWorkItem?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    lastConfirmedIsDark = UIScreen.main.traitCollection.userInterfaceStyle == .dark
    setupLifecycleAndAppearanceObservers()
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    let messenger = engineBridge.applicationRegistrar.messenger()

    let qrChannel = FlutterMethodChannel(
      name: "com.englishpod.trancy/qr_scanner",
      binaryMessenger: messenger
    )
    self.qrScannerChannel = qrChannel
    qrChannel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else {
        result(nil)
        return
      }
      if call.method == "scanQrCode" {
        DispatchQueue.main.async {
          self.handleScanQrCode(result: result)
        }
      } else {
        result(FlutterMethodNotImplemented)
      }
    }

    let channel = FlutterMethodChannel(
      name: "com.englishpod.trancy/wakelock",
      binaryMessenger: messenger
    )
    self.wakelockChannel = channel

    channel.setMethodCallHandler { [weak self] call, result in
      guard let self = self else {
        result(nil)
        return
      }
      switch call.method {
      case "setKeepScreenOn":
        let args = call.arguments as? [String: Any]
        let enable = (args?["enable"] as? Bool) ?? false
        DispatchQueue.main.async {
          UIApplication.shared.isIdleTimerDisabled = enable
        }
        result(nil)

      case "getSystemIsDark":
        DispatchQueue.main.async {
          if UIApplication.shared.applicationState == .active {
            self.lastConfirmedIsDark = UIScreen.main.traitCollection.userInterfaceStyle == .dark
          }
          result(self.lastConfirmedIsDark)
        }

      case "configureBrandArtwork":
        let args = call.arguments as? [String: Any]
        let darkPath = args?["darkPath"] as? String
        let lightPath = args?["lightPath"] as? String
        DispatchQueue.main.async {
          if let darkPath = darkPath, !darkPath.isEmpty {
            self.darkArtworkImage = UIImage(contentsOfFile: darkPath)
          }
          if let lightPath = lightPath, !lightPath.isEmpty {
            self.lightArtworkImage = UIImage(contentsOfFile: lightPath)
          }
          if UIApplication.shared.applicationState == .active {
            self.lastConfirmedIsDark = UIScreen.main.traitCollection.userInterfaceStyle == .dark
          }
          self.attachObserverViewIfNeeded()
          self.applyNativeNowPlayingArtwork(isDark: self.lastConfirmedIsDark)
          result(self.lastConfirmedIsDark)
        }

      default:
        result(FlutterMethodNotImplemented)
      }
    }
  }

  private func handleScanQrCode(result: @escaping FlutterResult) {
    let status = AVCaptureDevice.authorizationStatus(for: .video)
    switch status {
    case .authorized:
      presentQrScanner(result: result)
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        DispatchQueue.main.async {
          guard let self = self else {
            result(nil)
            return
          }
          if granted {
            self.presentQrScanner(result: result)
          } else {
            result(FlutterError(
              code: "CAMERA_PERMISSION_DENIED",
              message: "Camera permission denied",
              details: nil
            ))
          }
        }
      }
    case .denied, .restricted:
      result(FlutterError(
        code: "CAMERA_PERMISSION_DENIED",
        message: "Camera permission denied",
        details: nil
      ))
    @unknown default:
      result(FlutterError(
        code: "CAMERA_UNAVAILABLE",
        message: "Camera authorization unavailable",
        details: nil
      ))
    }
  }

  private func presentQrScanner(result: @escaping FlutterResult) {
    guard let root = topMostViewController() else {
      result(FlutterError(
        code: "CAMERA_UNAVAILABLE",
        message: "No active presenter view controller",
        details: nil
      ))
      return
    }
    let scanner = EpQrScannerViewController()
    scanner.modalPresentationStyle = .fullScreen
    scanner.onComplete = { payload in
      result(payload)
    }
    root.present(scanner, animated: true)
  }

  private func topMostViewController() -> UIViewController? {
    var current = activeKeyWindow()?.rootViewController
    while let presented = current?.presentedViewController {
      current = presented
    }
    return current
  }

  private func setupLifecycleAndAppearanceObservers() {
    let nc = NotificationCenter.default
    nc.addObserver(
      self,
      selector: #selector(handleDidEnterBackground),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
    nc.addObserver(
      self,
      selector: #selector(handleDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )
    nc.addObserver(
      self,
      selector: #selector(handleWindowDidBecomeKey),
      name: UIWindow.didBecomeKeyNotification,
      object: nil
    )
  }

  @objc private func handleWindowDidBecomeKey() {
    attachObserverViewIfNeeded()
  }

  @objc private func handleDidEnterBackground() {
    backgroundSnapshotGuardUntil = ProcessInfo.processInfo.systemUptime + 0.75
    pendingAppearanceWorkItem?.cancel()
  }

  @objc private func handleDidBecomeActive() {
    backgroundSnapshotGuardUntil = 0
    attachObserverViewIfNeeded()
    evaluateSystemAppearanceChange(delay: 0.05, allowFromActive: true)
  }

  private func attachObserverViewIfNeeded() {
    guard let targetWindow = activeKeyWindow() else { return }
    if let existing = appearanceObserverView {
      if existing.window === targetWindow { return }
      existing.removeFromSuperview()
    }
    let obs = SystemAppearanceObserverView(frame: .zero)
    obs.isHidden = true
    obs.isUserInteractionEnabled = false
    obs.onTraitChanged = { [weak self] in
      self?.onNativeTraitCollectionChanged()
    }
    targetWindow.addSubview(obs)
    appearanceObserverView = obs
  }

  private func activeKeyWindow() -> UIWindow? {
    for scene in UIApplication.shared.connectedScenes {
      if let windowScene = scene as? UIWindowScene {
        if let keyWin = windowScene.windows.first(where: { $0.isKeyWindow }) {
          return keyWin
        }
        if let firstWin = windowScene.windows.first {
          return firstWin
        }
      }
    }
    return nil
  }

  private func onNativeTraitCollectionChanged() {
    let now = ProcessInfo.processInfo.systemUptime
    if now < backgroundSnapshotGuardUntil {
      return
    }
    evaluateSystemAppearanceChange(
      delay: 0.16,
      allowFromActive: UIApplication.shared.applicationState == .active
    )
  }

  private func evaluateSystemAppearanceChange(delay: TimeInterval, allowFromActive: Bool) {
    pendingAppearanceWorkItem?.cancel()
    let work = DispatchWorkItem { [weak self] in
      guard let self = self else { return }
      let now = ProcessInfo.processInfo.systemUptime
      if !allowFromActive && now < self.backgroundSnapshotGuardUntil {
        return
      }
      let isDarkNow = UIScreen.main.traitCollection.userInterfaceStyle == .dark
      if isDarkNow != self.lastConfirmedIsDark {
        self.lastConfirmedIsDark = isDarkNow
        self.applyNativeNowPlayingArtwork(isDark: isDarkNow)
        self.wakelockChannel?.invokeMethod(
          "onSystemAppearanceChanged",
          arguments: ["isDark": isDarkNow]
        )
      }
    }
    pendingAppearanceWorkItem = work
    DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
  }

  private func applyNativeNowPlayingArtwork(isDark: Bool) {
    guard let img = isDark ? darkArtworkImage : lightArtworkImage else { return }
    let center = MPNowPlayingInfoCenter.default()
    guard var info = center.nowPlayingInfo, !info.isEmpty else { return }
    let art = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
    info[MPMediaItemPropertyArtwork] = art
    center.nowPlayingInfo = info
  }
}
