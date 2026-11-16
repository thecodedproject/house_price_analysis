module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testPathIgnorePatterns: ["/node_modules/", "/dist/", "/data/"],
  moduleNameMapper: {
    "\\.css$": "<rootDir>/__mocks__/style_mock.js",
  },
};
