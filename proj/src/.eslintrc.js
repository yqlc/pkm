module.exports = {
  env: {
    commonjs: true,
    es2021: true,
    node: true
  },
  extends: [
    'standard', // 使用流行的 Standard 规范
    'plugin:prettier/recommended' // 整合 Prettier，防止冲突
  ],
  parserOptions: {
    ecmaVersion: 'latest'
  },
  rules: {
    // 强制使用 const，除非变量会被重新赋值
    'prefer-const': 'error',

    // 工业级要求：生产环境禁止遗留 console.log，强制使用 logger
    'no-console': ['warn', { allow: ['warn', 'error'] }],

    // 允许使用 async/await 且不强制 try-catch (由上层统一捕获)
    'no-return-await': 'off',

    // 变量声明必须使用
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // 强制驼峰命名
    camelcase: ['error', { properties: 'never' }],

    // Prettier 的规则作为 ESLint 错误抛出
    'prettier/prettier': 'error'
  }
};
