const fs = require('fs-extra');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC_DIR = __dirname;
const DIST_DIR = path.join(__dirname, 'dist');

// 需要忽略的目录或文件
const IGNORE_DIRS = ['.git', 'node_modules', 'dist', 'logs', 'database'];
const IGNORE_FILES = ['build.js', 'package.json', 'package-lock.json', '.gitignore', '.eslintrc.js', '.prettierrc'];

// 混淆配置
const obfuscationOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 1,
  numbersToExpressions: true,
  simplify: true,
  stringArrayShuffle: true,
  splitStrings: true,
  stringArrayThreshold: 1,
  target: 'node'
};

async function build() {
  console.log('>>> 开始构建与混淆...');

  // 1. 清理旧的 dist 目录
  await fs.remove(DIST_DIR);
  await fs.ensureDir(DIST_DIR);

  // 2. 遍历并处理文件
  const files = await fs.readdir(SRC_DIR);

  for (const file of files) {
    if (IGNORE_DIRS.includes(file) || IGNORE_FILES.includes(file)) {
      continue;
    }

    const srcPath = path.join(SRC_DIR, file);
    const destPath = path.join(DIST_DIR, file);
    const stat = await fs.stat(srcPath);

    if (stat.isDirectory()) {
      // 递归拷贝目录 (简单起见，目录内文件暂不混淆，如果需要深度混淆需写递归函数)
      // 对于本工程结构，主要代码在根目录或 modules 下，建议这里做递归处理
      await copyAndObfuscateDir(srcPath, destPath);
    } else if (file.endsWith('.js')) {
      // 混淆 JS 文件
      await obfuscateFile(srcPath, destPath);
    } else {
      // 直接拷贝非 JS 文件 (如 config.json 等)
      await fs.copy(srcPath, destPath);
    }
  }

  // 3. 拷贝必须的静态资源或 Config (如果 config 不需要混淆)
  // await fs.copy(path.join(SRC_DIR, 'config'), path.join(DIST_DIR, 'config'));
  
  // 4. 创建 package.json 到 dist (只包含运行脚本)
  const pkg = require('./package.json');
  pkg.scripts = { start: "node app.js" };
  delete pkg.devDependencies;
  await fs.writeJson(path.join(DIST_DIR, 'package.json'), pkg, { spaces: 2 });

  console.log('>>> 构建完成！生产代码位于 ./dist 目录');
}

async function copyAndObfuscateDir(srcDir, destDir) {
  await fs.ensureDir(destDir);
  const items = await fs.readdir(srcDir);
  for (const item of items) {
    const srcPath = path.join(srcDir, item);
    const destPath = path.join(destDir, item);
    const stat = await fs.stat(srcPath);
    
    if (stat.isDirectory()) {
      await copyAndObfuscateDir(srcPath, destPath);
    } else if (item.endsWith('.js')) {
      await obfuscateFile(srcPath, destPath);
    } else {
      await fs.copy(srcPath, destPath);
    }
  }
}

async function obfuscateFile(src, dest) {
  console.log(`正在混淆: ${path.basename(src)}`);
  const code = await fs.readFile(src, 'utf8');
  const obfuscationResult = JavaScriptObfuscator.obfuscate(code, obfuscationOptions);
  await fs.writeFile(dest, obfuscationResult.getObfuscatedCode());
}

build().catch(err => console.error(err));