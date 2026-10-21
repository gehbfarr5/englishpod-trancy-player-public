/// Resolve only sanitized lesson basenames under the configured audio root.
/// Default is same-origin; media stays separate from each frontend release.
Uri webAudioUri(Uri page, String lessonId, String audioPath,
    {String audioRoot = '/audio/'}) {
  if (!RegExp(r'^\d{4}$').hasMatch(lessonId) ||
      !RegExp(r'^[A-Za-z0-9][A-Za-z0-9_.-]*\.(mp3|m4a|aac|wav)$',
              caseSensitive: false)
          .hasMatch(audioPath)) {
    throw ArgumentError('Invalid sanitized lesson audio reference');
  }
  final root = page.resolve(audioRoot.endsWith('/') ? audioRoot : '$audioRoot/');
  if (!['http', 'https'].contains(root.scheme) || root.hasQuery ||
      root.hasFragment || root.userInfo.isNotEmpty ||
      (page.scheme == 'https' && root.scheme != 'https')) {
    throw ArgumentError('Invalid Web audio root');
  }
  return root.resolve('$lessonId/$audioPath');
}
