const { listFolders, getBreadcrumb } = require('./folderService');
const { listFilesInFolder } = require('./fileService');
const { getFileTypeLabel } = require('./downloadHelper');

async function listEntries(folderId, baseUrl, { canViewFolder } = {}) {
  let folders = await listFolders(folderId);
  if (canViewFolder) {
    const visible = [];
    for (const folder of folders) {
      if (await canViewFolder(folder.id)) visible.push(folder);
    }
    folders = visible;
  }
  const files = await listFilesInFolder(folderId);
  const breadcrumb = await getBreadcrumb(folderId ?? null);

  return {
    folderId: folderId ?? null,
    breadcrumb,
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      type: 'folder',
      createTime: f.createTime,
      private: Boolean(f.private),
    })),
    files: files.map((f) => ({
      id: f.id,
      name: f.fileName,
      type: 'file',
      size: f.size,
      md5: f.md5,
      desc: f.desc,
      uploadTime: f.uploadTime,
      fileType: getFileTypeLabel(f.fileName),
      relativePath: f.relativePath,
      downloadUrl: `${baseUrl}/download/${encodeURI(f.relativePath || f.fileName)}`,
    })),
  };
}

module.exports = { listEntries };
