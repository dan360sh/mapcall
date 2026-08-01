module.exports = {
  appId: 'com.streeteye.app',
  productName: 'MapCall',
  directories: { output: 'release' },
  files: ['www/**/*', 'electron/**/*', 'package.json'],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/icon.ico',
  },
  linux: {
    target: [
      { target: 'AppImage', arch: ['x64'] },
      { target: 'deb', arch: ['x64'] },
    ],
    icon: 'assets/icon.png',
  },
};
