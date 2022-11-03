'use strict';

const Path = require('node:path');
const TerserPlugin = require('terser-webpack-plugin');

const isProduction = true;//(process.env.NODE_ENV === 'production');

const config = {
  entry:    './src/index.js',
  devtool:  'source-map',
  mode:     'production',
  output:   {
    path:               Path.resolve('./dist'),
    scriptType:         'module',
    filename:           'index.js',
    sourceMapFilename:  'index.js.map',
    libraryTarget:      'module',
  },
  plugins: [
    // Add your plugins here
    // Learn more about plugins from https://webpack.js.org/configuration/plugins/
  ],
  module: {
  },
  experiments: {
    outputModule: true,
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        parallel:       true,
        terserOptions:  {
          keep_classnames:  true,
          keep_fnames:      true,
          ecma:             2015,
          module:           true,
        },
      }),
    ],
  },
};

module.exports = () => {
  if (isProduction)
    config.mode = 'production';
  else
    config.mode = 'development';

  return config;
};
