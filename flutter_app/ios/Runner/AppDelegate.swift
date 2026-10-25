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

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var wakelockChannel: FlutterMethodChannel?
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
    let channel = FlutterMethodChannel(
      name: "com.englishpod.trancy/wakelock",
      binaryMessenger: engineBridge.applicationRegistrar.messenger()
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
