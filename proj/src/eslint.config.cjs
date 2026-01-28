const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    // 继承推荐规则
    ...js.configs.recommended,

    // 文件匹配
    files: ['**/*.js', '**/*.cjs', '**/*.mjs', '**/*.jsx'],

    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs', // CommonJS 项目用这个, ESM 项目用 'module'
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      // 自定义规则
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
      'no-console': 'warn',
      'no-unused-vars': ['error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }],
      'indent': ['error', 2],
      'comma-dangle': ['error', 'only-multiline'],
      'no-trailing-spaces': 'error',
      'eol-last': ['error', 'always'],
    },
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.next/**',
      '**/out/**',
      '**/public/**',
      '**/*.min.js',
      '**/package-lock.json',
      '**/yarn.lock',
      '**/pnpm-lock.yaml',
      '.git/**',

      // 特定的文件或目录
      'temp/**',
      'logs/**',
      'profiles/**',
      'asset/*.sqlite',
      '*.log',
      '.env',
    ],
  },
  // 可以针对特定文件类型添加更多配置
  {
    files: ['**/*.test.js'],
    rules: {
      'no-unused-expressions': 'off',
    },
  },
];
