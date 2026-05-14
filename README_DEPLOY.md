# EdgeOne 部署说明

这个 `site/` 目录就是当前可直接部署的静态站点根目录。

当前版本：
- `25` 道题
- `1365` 位女主
- `281` 部作品
- `1286` 张角色图

## 最省事的上传方式

直接上传 `site/` 目录内容。

路径：

- [site](F:/gal解包/gal女主匹配项目/site)

注意：
- 当前站点总大小约 `35.94 MB`
- EdgeOne 直接上传支持文件夹，但单个文件有大小限制
- 因为压缩包会超过单文件限制，所以不建议上传 ZIP

## 站点入口

- `index.html`：正式测试页
- `name-editor.html`：中文名编辑页

## 如果你重新生成数据

在项目根目录执行：

```bash
python build_match_quiz_site.py
```

## 这次部署要上传什么

直接上传 `site/` 目录内容。

注意：
- 不要上传项目根目录
- 如果你是在控制台里拖文件夹，确认站点根目录最终直接能看到 `index.html`
- 站点根目录里必须直接能看到 `index.html`

## 相关文件

- [index.html](F:/gal解包/gal女主匹配项目/site/index.html)
- [app.js](F:/gal解包/gal女主匹配项目/site/app.js)
- [styles.css](F:/gal解包/gal女主匹配项目/site/styles.css)
- [site-data.js](F:/gal解包/gal女主匹配项目/site/data/site-data.js)
- [name-editor.html](F:/gal解包/gal女主匹配项目/site/name-editor.html)
