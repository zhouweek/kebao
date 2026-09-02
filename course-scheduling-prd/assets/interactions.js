(function () {
  function activateView(group, targetId) {
    document.querySelectorAll('[data-tabs="' + group + '"] button').forEach(function (button) {
      button.classList.toggle('active', button.dataset.target === targetId);
    });
    var container = document.querySelector('[data-tabs="' + group + '"]').closest('.prototype');
    container.querySelectorAll('.phone-view').forEach(function (view) {
      view.classList.toggle('active', view.id === targetId);
    });
  }

  document.querySelectorAll('[data-tabs] button').forEach(function (button) {
    button.addEventListener('click', function () {
      activateView(button.parentElement.dataset.tabs, button.dataset.target);
    });
  });

  var createEntry = document.querySelector('[data-open-create]');
  if (createEntry) {
    createEntry.addEventListener('click', function () {
      activateView('teacher', 'teacher-create');
    });
  }

  var teacherSubmit = document.getElementById('teacher-submit');
  if (teacherSubmit) {
    teacherSubmit.addEventListener('click', function () {
      var notice = document.getElementById('teacher-notice');
      notice.classList.add('show');
      teacherSubmit.textContent = '存在冲突，无法发布';
      teacherSubmit.disabled = true;
      window.setTimeout(function () {
        teacherSubmit.textContent = '发布并开放预约';
        teacherSubmit.disabled = false;
      }, 1800);
    });
  }

  var bookCourse = document.getElementById('book-course');
  if (bookCourse) {
    bookCourse.addEventListener('click', function () {
      document.getElementById('booking-success').hidden = false;
      bookCourse.textContent = '已预约';
      bookCourse.disabled = true;
    });
  }

  var cancelBooking = document.getElementById('cancel-booking');
  if (cancelBooking) {
    cancelBooking.addEventListener('click', function () {
      document.getElementById('cancel-success').hidden = false;
      cancelBooking.textContent = '已取消';
      cancelBooking.disabled = true;
    });
  }

  document.querySelectorAll('[data-admin-nav] button').forEach(function (button) {
    button.addEventListener('click', function () {
      document.querySelectorAll('[data-admin-nav] button').forEach(function (item) {
        item.classList.toggle('active', item === button);
      });
      document.querySelectorAll('.admin-panel').forEach(function (panel) {
        panel.classList.toggle('active', panel.id === button.dataset.panel);
      });
    });
  });

  var addUser = document.getElementById('add-user');
  if (addUser) {
    addUser.addEventListener('click', function () {
      var row = document.createElement('tr');
      row.innerHTML = '<td>新老师</td><td>老师</td><td>待绑定</td><td><span class="tag orange">待激活</span></td><td>编辑 · 撤销</td>';
      document.getElementById('user-rows').appendChild(row);
      addUser.textContent = '已新增待激活账号';
      addUser.disabled = true;
    });
  }
})();
